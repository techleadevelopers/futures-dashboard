/**
 * CandleEdge — market-side of the Edge Engine.
 *
 * Fetches OHLCV candles from BingX and computes technical indicators:
 *   - EMA(9) and EMA(21) crossover → trend direction
 *   - RSI(14) → momentum / overbought / oversold
 *   - ATR(14) → volatility, used for dynamic TP/SL sizing
 *   - Volume surge ratio vs 14-period avg
 *
 * Combined market score mirrors the Rust sizing_score() concept:
 *   marketScore = emaCross × 0.45 + rsiSignal × 0.35 + volumeBoost × 0.20
 *
 * Results are cached 30s per symbol to avoid hammering the public endpoint.
 */

const BINGX_PUBLIC = "https://open-api.bingx.com";
const CACHE_TTL_MS = 30_000; // 30 seconds
const CANDLE_LIMIT = 30;     // enough for EMA21 + ATR14 + RSI14

export type EdgeSide = "LONG" | "SHORT" | "NEUTRAL";
export type CandleInterval = "1m" | "3m" | "5m" | "15m";

export interface CandleEdge {
  symbol: string;
  interval: CandleInterval;
  candleCount: number;
  lastClose: number;
  ema9: number;
  ema21: number;
  emaCross: "BULLISH" | "BEARISH" | "FLAT";
  emaCrossPct: number;      // (ema9 - ema21) / ema21 × 100
  rsi14: number;
  atr14: number;            // in price units
  atrPct: number;           // ATR / close × 100
  volumeRatio: number;      // current candle vol / avg14 vol
  longScore: number;        // 0–1, how good a LONG setup is
  shortScore: number;       // 0–1, how good a SHORT setup is
  suggestedSide: EdgeSide;
  fetchedAt: number;
  error?: string;
}

// ── In-memory cache ───────────────────────────────────────────────────────────

const _cache = new Map<string, CandleEdge>();

function cacheKey(symbol: string, interval: CandleInterval): string {
  return `${symbol}:${interval}`;
}

function getCached(symbol: string, interval: CandleInterval): CandleEdge | null {
  const key = cacheKey(symbol, interval);
  const cached = _cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) {
    _cache.delete(key);
    return null;
  }
  return cached;
}

function setCache(edge: CandleEdge): void {
  _cache.set(cacheKey(edge.symbol, edge.interval), edge);
}

// ── Indicator math ────────────────────────────────────────────────────────────

function ema(closes: number[], period: number): number[] {
  if (closes.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    result.push(closes[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function rsi14(closes: number[]): number {
  if (closes.length < 15) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= 14; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / 14;
  let avgLoss = losses / 14;
  for (let i = 15; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * 13 + gain) / 14;
    avgLoss = (avgLoss * 13 + loss) / 14;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function atr14(highs: number[], lows: number[], closes: number[]): number {
  if (closes.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    trs.push(Math.max(hl, hc, lc));
  }
  if (trs.length === 0) return 0;
  const period = Math.min(14, trs.length);
  const k = 2 / (period + 1);
  let atrVal = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atrVal = trs[i] * k + atrVal * (1 - k);
  }
  return atrVal;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function computeScores(
  ema9val: number,
  ema21val: number,
  rsi: number,
  volRatio: number,
): { longScore: number; shortScore: number } {
  const emaDeltaPct = (ema9val - ema21val) / (ema21val || 1);
  const emaBullStrength = clamp01(emaDeltaPct * 200);   // +0.5% ema spread = score 1
  const emaBearStrength = clamp01(-emaDeltaPct * 200);

  // RSI signal for LONG: oversold < 45 is great, overbought > 70 is penalty
  const rsiLong  = rsi < 50
    ? clamp01((55 - rsi) / 25)     // RSI 30 → 1.0, RSI 55 → 0.0
    : clamp01((75 - rsi) / 25);    // RSI 55 → 0.8, RSI 75 → 0.0, RSI 80 → penalty
  const rsiShort = rsi > 50
    ? clamp01((rsi - 45) / 25)
    : clamp01((rsi - 25) / 25);

  const volBoost = clamp01(volRatio / 2.5); // 2.5× avg volume = max score

  const longScore  = clamp01(emaBullStrength * 0.45 + rsiLong  * 0.35 + volBoost * 0.20);
  const shortScore = clamp01(emaBearStrength * 0.45 + rsiShort * 0.35 + volBoost * 0.20);

  return { longScore, shortScore };
}

// ── Symbol normalization ──────────────────────────────────────────────────────
// BingX klines API requires "BASE-QUOTE" format (e.g. ETH-USDT, not ETHUSDT).

function toKlineSymbol(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.includes("-")) return s; // already formatted
  if (s.endsWith("USDT")) return `${s.slice(0, -4)}-USDT`;
  if (s.endsWith("USDC")) return `${s.slice(0, -4)}-USDC`;
  if (s.endsWith("USD"))  return `${s.slice(0, -3)}-USDT`; // BTCUSD → BTC-USDT
  return s; // fallback
}

// ── BingX candle fetch ────────────────────────────────────────────────────────

interface RawCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// BingX v3 klines response row shape: {open, close, high, low, volume, time}
interface BingXKlineRow {
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  time: number;
}

async function fetchCandles(
  symbol: string,
  interval: CandleInterval,
  limit: number,
): Promise<RawCandle[]> {
  const klineSymbol = toKlineSymbol(symbol);
  const url =
    `${BINGX_PUBLIC}/openApi/swap/v3/quote/klines` +
    `?symbol=${encodeURIComponent(klineSymbol)}&interval=${interval}&limit=${limit}`;

  const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
  const json = (await resp.json()) as Record<string, unknown>;

  if (json.code !== 0) {
    throw new Error(`BingX klines error ${symbol} (${klineSymbol}): ${json.msg ?? json.code}`);
  }

  const rows = json.data as BingXKlineRow[];
  if (!Array.isArray(rows)) throw new Error(`Unexpected klines shape for ${symbol}`);

  // Sort ascending by time (BingX returns most recent last, but order can vary)
  return rows
    .map((r) => ({
      openTime: Number(r.time),
      open:     parseFloat(r.open),
      high:     parseFloat(r.high),
      low:      parseFloat(r.low),
      close:    parseFloat(r.close),
      volume:   parseFloat(r.volume),
    }))
    .sort((a, b) => a.openTime - b.openTime);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute CandleEdge for a single symbol.
 * Returns cached result if fresh (< 30s old).
 */
export async function computeCandleEdge(
  symbol: string,
  interval: CandleInterval = "5m",
): Promise<CandleEdge> {
  const cached = getCached(symbol, interval);
  if (cached) return cached;

  try {
    const candles = await fetchCandles(symbol, interval, CANDLE_LIMIT);
    if (candles.length < 5) {
      throw new Error(`Not enough candles: ${candles.length}`);
    }

    const closes  = candles.map((c) => c.close);
    const highs   = candles.map((c) => c.high);
    const lows    = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);

    const ema9vals  = ema(closes, 9);
    const ema21vals = ema(closes, 21);
    const ema9val   = ema9vals[ema9vals.length - 1];
    const ema21val  = ema21vals[ema21vals.length - 1];

    const rsiVal = rsi14(closes);
    const atrVal = atr14(highs, lows, closes);

    const recentVol  = volumes[volumes.length - 1];
    const avgVol14   = volumes.slice(-15, -1).reduce((s, v) => s + v, 0) / Math.min(14, volumes.length - 1);
    const volRatio   = avgVol14 > 0 ? recentVol / avgVol14 : 1;

    const emaCrossPct = ((ema9val - ema21val) / (ema21val || 1)) * 100;
    const emaCross: CandleEdge["emaCross"] =
      Math.abs(emaCrossPct) < 0.02 ? "FLAT" :
      ema9val > ema21val ? "BULLISH" : "BEARISH";

    const lastClose = closes[closes.length - 1];
    const atrPct = lastClose > 0 ? (atrVal / lastClose) * 100 : 0;

    const { longScore, shortScore } = computeScores(ema9val, ema21val, rsiVal, volRatio);

    const suggestedSide: EdgeSide =
      longScore > shortScore && longScore > 0.35 ? "LONG" :
      shortScore > longScore && shortScore > 0.35 ? "SHORT" : "NEUTRAL";

    const edge: CandleEdge = {
      symbol,
      interval,
      candleCount: candles.length,
      lastClose,
      ema9: ema9val,
      ema21: ema21val,
      emaCross,
      emaCrossPct,
      rsi14: rsiVal,
      atr14: atrVal,
      atrPct,
      volumeRatio: volRatio,
      longScore,
      shortScore,
      suggestedSide,
      fetchedAt: Date.now(),
    };

    setCache(edge);
    return edge;
  } catch (err) {
    const fallback: CandleEdge = {
      symbol,
      interval,
      candleCount: 0,
      lastClose: 0,
      ema9: 0,
      ema21: 0,
      emaCross: "FLAT",
      emaCrossPct: 0,
      rsi14: 50,
      atr14: 0,
      atrPct: 0,
      volumeRatio: 1,
      longScore: 0,
      shortScore: 0,
      suggestedSide: "NEUTRAL",
      fetchedAt: Date.now(),
      error: err instanceof Error ? err.message : String(err),
    };
    setCache(fallback); // cache errors too (30s) to avoid hammering
    return fallback;
  }
}

/**
 * Fetch CandleEdge for multiple symbols in parallel.
 * Results are returned in the same order as the input array.
 */
export async function computeAllCandleEdges(
  symbols: string[],
  interval: CandleInterval = "5m",
): Promise<CandleEdge[]> {
  const results = await Promise.allSettled(
    symbols.map((sym) => computeCandleEdge(sym, interval)),
  );
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          symbol: symbols[i],
          interval,
          candleCount: 0,
          lastClose: 0,
          ema9: 0,
          ema21: 0,
          emaCross: "FLAT" as const,
          emaCrossPct: 0,
          rsi14: 50,
          atr14: 0,
          atrPct: 0,
          volumeRatio: 1,
          longScore: 0,
          shortScore: 0,
          suggestedSide: "NEUTRAL" as const,
          fetchedAt: Date.now(),
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        },
  );
}

/** Invalidate cache for a symbol (call after placing a trade) */
export function invalidateCandleCache(symbol: string): void {
  for (const interval of ["1m", "3m", "5m", "15m"] as CandleInterval[]) {
    _cache.delete(cacheKey(symbol, interval));
  }
}

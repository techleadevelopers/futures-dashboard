/**
 * Adaptive Edge Engine — futures equivalent of adaptive.rs from the MEV runtime.
 *
 * Core math ported from Rust:
 *   - EWMA (exponentially weighted moving average) for all live metrics
 *   - ClusterKey: (symbol, positionSide, hourUtc, btcRegime) — the "router+pair+hour" of futures
 *   - ContextSignal: priority_score + toxicity_score per cluster
 *   - Dynamic threshold calibration from realized outcomes
 *
 * Priority score formula (adaptive.rs line ~380):
 *   priority = winRate×0.46 + realizedCapture×0.34 + (1−slHitRate)×0.12 + pfScore×0.08
 *
 * Toxicity score formula (adaptive.rs line ~390):
 *   toxicity = (1−winRate)×0.28 + slHitRate×0.36 + (1−profitFactorNorm)×0.22 + (1−realizedCapture)×0.14
 *
 * Never modify these weights without A/B evidence from at least 100 trades.
 */

// ── Constants (matching adaptive.rs) ──────────────────────────────────────────
const EWMA_FAST = 0.20; // upper bound for per-trade adaptation
const EWMA_SLOW = 0.08; // stable signal: cross-session smoothing
const MIN_SAMPLES_FOR_GATE = 10; // don't gate until we have real data
const PRIORITY_SCORE_NEUTRAL = 0.50;
const TOXICITY_SCORE_NEUTRAL = 0.50;

// ── Types ─────────────────────────────────────────────────────────────────────

export type BtcRegime = "BULL" | "BEAR" | "NEUTRAL";
export type PositionSide = "LONG" | "SHORT";
export type ExitReason = "TP" | "SL" | "MANUAL";

/** Equivalent to ClusterKey in adaptive.rs */
export interface ClusterKey {
  symbol: string;
  positionSide: PositionSide;
  hourUtc: number;   // 0–23 UTC
  btcRegime: BtcRegime;
}

/** Equivalent to ContextSignal in adaptive.rs */
export interface ContextSignal {
  priorityScore: number;  // 0–1, higher = historically strong setup
  toxicityScore: number;  // 0–1, higher = historically toxic, avoid
  samples: number;
}

/** A single realized trade outcome — the atomic telemetry unit */
export interface TradeOutcome {
  id: string;           // uuid or orderId from BingX
  isDemo?: boolean;
  source?: "bingx-live" | "bingx-vst" | "manual";
  entryOrderId?: string;
  exitOrderId?: string;
  symbol: string;
  positionSide: PositionSide;
  side: "BUY" | "SELL";
  entryTime: number;    // unix ms
  exitTime: number;
  hourUtc: number;      // derived from entryTime
  btcRegime: BtcRegime;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  leverage: number;
  marginUsed: number;
  grossPnl: number;     // before fees
  fee: number;          // absolute fee amount (positive)
  realizedPnl: number;  // grossPnl − fee
  expectedEntryPrice?: number;
  expectedExitPrice?: number;
  entrySlippage?: number;
  exitSlippage?: number;
  totalSlippage?: number;
  slippagePctNotional?: number;
  exitReason: ExitReason;
  // expected profit if TP was hit (marginUsed × takeProfitPct × leverage)
  expectedTpProfit: number;
}

/** Historical profile for a ClusterKey — persisted and recalculated */
export interface ClusterProfile {
  key: ClusterKey;
  samples: number;
  wins: number;
  losses: number;
  winRate: number;        // wins / samples
  avgWin: number;         // avg positive pnl
  avgLoss: number;        // avg negative pnl (negative number)
  ev: number;             // (winRate × avgWin) + ((1−winRate) × avgLoss)
  profitFactor: number;   // |avgWin| / |avgLoss|, ∞ if no losses
  totalPnl: number;
  totalFees: number;
  totalSlippage: number;
  avgSlippage: number;
  tpHitRate: number;      // % of exits via TP
  slHitRate: number;      // % of exits via SL
  realizedCapture: number; // median(realPnl / expectedTpProfit) for wins
  priorityScore: number;
  toxicityScore: number;
  ewmaWinRate: number;    // EWMA-smoothed win rate
  ewmaEv: number;         // EWMA-smoothed EV
  ewmaSlippage: number;
  realEv: number;
  lastUpdated: number;    // unix ms
}

/** Rolled-up view for a symbol across all hours and regimes */
export interface SymbolProfile {
  symbol: string;
  totalSamples: number;
  winRate: number;
  profitFactor: number;
  ev: number;
  totalPnl: number;
  totalFees: number;
  totalSlippage: number;
  avgSlippage: number;
  netPnl: number;
  isToxic: boolean;   // totalPnl < 0 after MIN_SAMPLES_FOR_GATE
  bestHour: number | null;
  worstHour: number | null;
  priorityScore: number;
  toxicityScore: number;
}

/** Adaptive gate recommendation — replaces static ENV thresholds */
export interface AdaptiveGateRecommendation {
  evMinThreshold: number;     // recommended SCALP_EV_MIN_THRESHOLD
  winRateMin: number;         // recommended SCALP_WIN_RATE_MIN
  profitFactorMin: number;    // recommended SCALP_PROFIT_FACTOR_MIN
  toxicSymbols: string[];     // recommended SCALP_SYMBOL_BLACKLIST
  toxicHours: number[];       // recommended SCALP_HOUR_BLACKLIST
  confidence: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";
  basedOnSamples: number;
  lastCalibrated: number;     // unix ms
}

// ── Utility functions (matching Rust EWMA) ────────────────────────────────────

function ewma(prev: number, newVal: number, alpha: number): number {
  return prev + alpha * (newVal - prev);
}

function clamp(val: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, val));
}

function adaptiveFastAlpha(samples: number, notional: number, slippagePctNotional: number): number {
  const sampleFactor = samples < 10 ? 1 : samples < 30 ? 0.75 : samples < 100 ? 0.55 : 0.40;
  const liquidityFactor = notional >= 100 ? 0.70 : notional >= 25 ? 0.85 : 1.0;
  const frictionFactor = slippagePctNotional > 0.002 ? 1.15 : slippagePctNotional > 0.001 ? 1.05 : 0.95;
  return clamp(EWMA_FAST * sampleFactor * liquidityFactor * frictionFactor, 0.04, EWMA_FAST);
}

function outcomeSlippage(outcome: TradeOutcome): number {
  return Math.max(0, outcome.totalSlippage ?? 0);
}

function clusterKeyStr(key: ClusterKey): string {
  return `${key.symbol}:${key.positionSide}:${key.hourUtc}:${key.btcRegime}`;
}

function symbolKeyStr(symbol: string): string {
  return symbol.toUpperCase();
}

// ── Score formulas (direct port of adaptive.rs ~line 380) ─────────────────────

function computePriorityScore(
  winRate: number,
  realizedCapture: number,
  slHitRate: number,
  profitFactor: number,
): number {
  const pfScore = clamp(profitFactor / 3.0, 0, 1); // normalize PF: 3x → 1.0
  return clamp(
    winRate * 0.46 +
    realizedCapture * 0.34 +
    (1 - slHitRate) * 0.12 +
    pfScore * 0.08,
    0, 1,
  );
}

function computeToxicityScore(
  winRate: number,
  realizedCapture: number,
  slHitRate: number,
  profitFactor: number,
): number {
  const pfNorm = clamp(profitFactor / 3.0, 0, 1);
  return clamp(
    (1 - winRate) * 0.28 +
    slHitRate * 0.36 +
    (1 - pfNorm) * 0.22 +
    (1 - clamp(realizedCapture, 0, 1)) * 0.14,
    0, 1,
  );
}

// ── AdaptiveEngine ────────────────────────────────────────────────────────────

export class AdaptiveEngine {
  /** Per-cluster profiles: (symbol, positionSide, hourUtc, regime) */
  private clusterProfiles = new Map<string, ClusterProfile>();

  /** Per-symbol rolled-up profiles */
  private symbolProfiles = new Map<string, SymbolProfile>();

  /** Global EWMA state */
  private globalEwmaWinRate = PRIORITY_SCORE_NEUTRAL;
  private globalEwmaEv = 0;
  private globalEwmaFee = 0;
  private totalTrades = 0;

  /** All raw outcomes for re-calibration */
  private outcomes: TradeOutcome[] = [];

  constructor(initialOutcomes: TradeOutcome[] = []) {
    if (initialOutcomes.length > 0) {
      this.rebuildFromOutcomes(initialOutcomes);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Record a realized trade outcome and update all EWMA state.
   * Equivalent to `apply_outcome` in the Rust adaptive module.
   */
  recordOutcome(outcome: TradeOutcome): void {
    this.outcomes.push(outcome);
    this.totalTrades++;

    const slippage = outcomeSlippage(outcome);
    const realPnl = outcome.realizedPnl - slippage;
    const win = realPnl > 0;
    const notional = Math.max(0, outcome.entryPrice * outcome.qty);
    const alphaFast = adaptiveFastAlpha(this.totalTrades, notional, outcome.slippagePctNotional ?? 0);

    // Update global EWMA
    this.globalEwmaWinRate = ewma(this.globalEwmaWinRate, win ? 1 : 0, alphaFast);
    this.globalEwmaEv = ewma(this.globalEwmaEv, realPnl, EWMA_SLOW);
    this.globalEwmaFee = ewma(this.globalEwmaFee, outcome.fee, EWMA_SLOW);

    // Update cluster profile
    this.updateClusterProfile(outcome);

    // Re-roll symbol profile
    this.rollupSymbolProfile(outcome.symbol);
  }

  /**
   * Returns the ContextSignal for a cluster.
   * Equivalent to `context_signal(router, hour_utc)` in adaptive.rs.
   */
  contextSignal(key: ClusterKey): ContextSignal {
    const profile = this.clusterProfiles.get(clusterKeyStr(key));
    if (!profile || profile.samples < MIN_SAMPLES_FOR_GATE) {
      return {
        priorityScore: PRIORITY_SCORE_NEUTRAL,
        toxicityScore: TOXICITY_SCORE_NEUTRAL,
        samples: profile?.samples ?? 0,
      };
    }
    return {
      priorityScore: profile.priorityScore,
      toxicityScore: profile.toxicityScore,
      samples: profile.samples,
    };
  }

  /**
   * Returns the profile for a specific cluster.
   */
  clusterProfile(key: ClusterKey): ClusterProfile | null {
    return this.clusterProfiles.get(clusterKeyStr(key)) ?? null;
  }

  /**
   * Returns all cluster profiles — used by the dashboard war room.
   */
  allClusterProfiles(): ClusterProfile[] {
    return Array.from(this.clusterProfiles.values());
  }

  /**
   * Returns the symbol-level profile.
   */
  symbolProfile(symbol: string): SymbolProfile | null {
    return this.symbolProfiles.get(symbolKeyStr(symbol)) ?? null;
  }

  /**
   * Returns all symbol profiles sorted by totalPnl.
   */
  allSymbolProfiles(): SymbolProfile[] {
    return Array.from(this.symbolProfiles.values()).sort(
      (a, b) => b.totalPnl - a.totalPnl,
    );
  }

  /**
   * Hour-of-day toxicity: best and worst trading hours across all symbols.
   * Equivalent to `router_hour_profiles` rollup in adaptive.rs.
   */
  hourProfile(): { hour: number; pnl: number; winRate: number; samples: number; priorityScore: number }[] {
    const byHour = new Map<number, { pnl: number; wins: number; total: number; prioritySum: number }>();

    for (const outcome of this.outcomes) {
      const h = outcome.hourUtc;
      const entry = byHour.get(h) ?? { pnl: 0, wins: 0, total: 0, prioritySum: 0 };
      entry.pnl += outcome.realizedPnl;
      entry.wins += outcome.realizedPnl > 0 ? 1 : 0;
      entry.total++;
      byHour.set(h, entry);
    }

    return Array.from(byHour.entries())
      .map(([hour, d]) => ({
        hour,
        pnl: d.pnl,
        winRate: d.total > 0 ? d.wins / d.total : 0,
        samples: d.total,
        priorityScore: d.total > 0 ? clamp(d.pnl / (d.total * Math.abs(this.globalEwmaEv || 0.01)), 0, 1) : PRIORITY_SCORE_NEUTRAL,
      }))
      .sort((a, b) => a.hour - b.hour);
  }

  /**
   * Global EWMA state snapshot — shown on dashboard.
   */
  globalState(): {
    ewmaWinRate: number;
    ewmaEv: number;
    ewmaFeePerTrade: number;
    totalTrades: number;
    outcomes: TradeOutcome[];
  } {
    return {
      ewmaWinRate: this.globalEwmaWinRate,
      ewmaEv: this.globalEwmaEv,
      ewmaFeePerTrade: this.globalEwmaFee,
      totalTrades: this.totalTrades,
      outcomes: this.outcomes,
    };
  }

  /**
   * Adaptive gate recommendation — equivalent to calibrated threshold output
   * after replaying historical profiles in the Rust adaptive module.
   *
   * Only recommends tightening thresholds, never loosening below safety floor.
   */
  gateRecommendation(): AdaptiveGateRecommendation {
    const samples = this.totalTrades;

    if (samples < MIN_SAMPLES_FOR_GATE) {
      return {
        evMinThreshold: 0,
        winRateMin: 0,
        profitFactorMin: 0,
        toxicSymbols: [],
        toxicHours: [],
        confidence: "INSUFFICIENT_DATA",
        basedOnSamples: samples,
        lastCalibrated: Date.now(),
      };
    }

    const allSymbols = this.allSymbolProfiles();
    const toxicSymbols = allSymbols
      .filter((s) => s.isToxic && s.totalSamples >= MIN_SAMPLES_FOR_GATE)
      .map((s) => s.symbol);

    const hourData = this.hourProfile();
    const toxicHours = hourData
      .filter((h) => h.pnl < 0 && h.samples >= 5)
      .map((h) => h.hour);

    // EV recommendation: set threshold at 50th percentile of positive-EV clusters
    const positiveEvClusters = Array.from(this.clusterProfiles.values())
      .filter((p) => (p.realEv ?? p.ev) > 0 && p.samples >= MIN_SAMPLES_FOR_GATE)
      .map((p) => p.realEv ?? p.ev)
      .sort((a, b) => a - b);

    const evThreshold = positiveEvClusters.length > 0
      ? positiveEvClusters[Math.floor(positiveEvClusters.length * 0.25)] // 25th pct
      : 0;

    const confidence = samples >= 100 ? "HIGH" : samples >= 50 ? "MEDIUM" : "LOW";

    return {
      evMinThreshold: Math.max(0, evThreshold),
      winRateMin: clamp(this.globalEwmaWinRate * 0.90, 0, 1), // 10% safety margin below current WR
      profitFactorMin: 1.0, // never recommend below 1.0 — that's negative EV
      toxicSymbols,
      toxicHours,
      confidence,
      basedOnSamples: samples,
      lastCalibrated: Date.now(),
    };
  }

  /**
   * Ranking score for a pending entry — equivalent to PendingExecutionCandidate.ranking_score()
   * in runtime.rs. Used to pick best entry when multiple symbols pass the gate.
   *
   * score = ev.max(0) × (0.65 + p_positive×0.35) × (0.70 + priority×0.30)
   */
  rankingScore(key: ClusterKey, currentEv: number): number {
    const signal = this.contextSignal(key);
    const pPositive = signal.priorityScore; // proxy for p(positive outcome)
    return Math.max(0, currentEv)
      * (0.65 + clamp(pPositive, 0, 1) * 0.35)
      * (0.70 + clamp(signal.priorityScore, 0, 1) * 0.30)
      * Math.max(0.1, 1.0 - signal.toxicityScore * 0.40);
  }

  /** All raw outcomes (for external serialization) */
  rawOutcomes(): TradeOutcome[] {
    return this.outcomes;
  }

  /**
   * Combined Edge Score — fuses adaptive telemetry with a real-time market signal.
   *
   * Ported from the Rust sizing_score() concept:
   *   adaptiveScore × (0.60 + marketScore × 0.40)
   *
   * Pre-learning phase (< 10 samples): returns pure market score so the bot
   * has a useful signal from day 1, before telemetry accumulates.
   *
   * Post-learning phase (≥ 10 samples): blends adaptive ranking with market.
   *
   * @param key         Cluster key (symbol, side, hour, regime)
   * @param ev          Current EV estimate from telemetry (or 0 if no data)
   * @param marketScore 0–1 signal from CandleEdge (longScore or shortScore)
   */
  combinedEdgeScore(key: ClusterKey, ev: number, marketScore: number): number {
    const signal = this.contextSignal(key);
    const market = clamp(marketScore, 0, 1);

    // Pre-learning phase: pure market score (adaptive engine hasn't seen enough trades)
    if (signal.samples < MIN_SAMPLES_FOR_GATE) {
      return market;
    }

    // Post-learning phase: adaptive × market blend
    const adaptive = this.rankingScore(key, ev);
    return clamp(adaptive * (0.60 + market * 0.40), 0, 10);
  }

  /**
   * Per-symbol edge summary for dashboard display.
   * Returns all metrics needed to render the Edge Telemetry panel.
   */
  edgeSummary(symbol: string, hourUtc: number, btcRegime: BtcRegime): {
    longEdge: { ev: number; winRate: number; priorityScore: number; toxicityScore: number; samples: number };
    shortEdge: { ev: number; winRate: number; priorityScore: number; toxicityScore: number; samples: number };
    symbolProfile: SymbolProfile | null;
  } {
    const buildEdge = (side: PositionSide) => {
      const key: ClusterKey = { symbol, positionSide: side, hourUtc, btcRegime };
      const cluster = this.clusterProfile(key);
      const signal = this.contextSignal(key);
      return {
        ev: cluster?.realEv ?? cluster?.ev ?? 0,
        winRate: cluster?.ewmaWinRate ?? 0,
        priorityScore: signal.priorityScore,
        toxicityScore: signal.toxicityScore,
        samples: signal.samples,
      };
    };
    return {
      longEdge: buildEdge("LONG"),
      shortEdge: buildEdge("SHORT"),
      symbolProfile: this.symbolProfile(symbol),
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private updateClusterProfile(outcome: TradeOutcome): void {
    const keyStr = clusterKeyStr({
      symbol: outcome.symbol,
      positionSide: outcome.positionSide,
      hourUtc: outcome.hourUtc,
      btcRegime: outcome.btcRegime,
    });

    const existing = this.clusterProfiles.get(keyStr);
    const slippage = outcomeSlippage(outcome);
    const realPnl = outcome.realizedPnl - slippage;
    const win = realPnl > 0;

    if (!existing) {
      const winRate = win ? 1 : 0;
      const avgWin = win ? realPnl : 0;
      const avgLoss = !win ? realPnl : 0;
      const profitFactor = avgWin > 0 && avgLoss < 0 ? Math.abs(avgWin / avgLoss) : 0;
      const tpHitRate = outcome.exitReason === "TP" ? 1 : 0;
      const slHitRate = outcome.exitReason === "SL" ? 1 : 0;
      const realizedCapture = outcome.exitReason === "TP" && outcome.expectedTpProfit > 0
        ? clamp(realPnl / outcome.expectedTpProfit, 0, 1.5)
        : 0.5;

      const priorityScore = computePriorityScore(winRate, realizedCapture, slHitRate, profitFactor);
      const toxicityScore = computeToxicityScore(winRate, realizedCapture, slHitRate, profitFactor);

      this.clusterProfiles.set(keyStr, {
        key: { symbol: outcome.symbol, positionSide: outcome.positionSide, hourUtc: outcome.hourUtc, btcRegime: outcome.btcRegime },
        samples: 1,
        wins: win ? 1 : 0,
        losses: win ? 0 : 1,
        winRate,
        avgWin,
        avgLoss,
        ev: realPnl, // single sample, net of execution slippage
        profitFactor,
        totalPnl: realPnl,
        totalFees: outcome.fee,
        totalSlippage: slippage,
        avgSlippage: slippage,
        tpHitRate,
        slHitRate,
        realizedCapture,
        priorityScore,
        toxicityScore,
        ewmaWinRate: winRate,
        ewmaEv: outcome.realizedPnl,
        ewmaSlippage: slippage,
        realEv: outcome.realizedPnl - slippage,
        lastUpdated: Date.now(),
      });
      return;
    }

    // ── EWMA update (matching Rust adaptive_observe pattern) ────────────────
    const n = existing.samples + 1;
    const wins = existing.wins + (win ? 1 : 0);
    const losses = existing.losses + (win ? 0 : 1);
    const winRate = wins / n;
    const alphaFast = adaptiveFastAlpha(existing.samples, outcome.entryPrice * outcome.qty, outcome.slippagePctNotional ?? 0);

    // Running average for win/loss amounts
    const avgWin = win
      ? existing.avgWin + (realPnl - existing.avgWin) / Math.max(wins, 1)
      : existing.avgWin;
    const avgLoss = !win
      ? existing.avgLoss + (realPnl - existing.avgLoss) / Math.max(losses, 1)
      : existing.avgLoss;

    const profitFactor = avgWin > 0 && avgLoss < 0 ? Math.abs(avgWin / avgLoss) : (avgWin > 0 ? 999 : 0);
    const ev = winRate * avgWin + (1 - winRate) * avgLoss;

    const tpCount = existing.tpHitRate * existing.samples + (outcome.exitReason === "TP" ? 1 : 0);
    const slCount = existing.slHitRate * existing.samples + (outcome.exitReason === "SL" ? 1 : 0);
    const tpHitRate = tpCount / n;
    const slHitRate = slCount / n;

    // realizedCapture: ratio of actual to expected TP profit
    const tradeCapture = outcome.exitReason === "TP" && outcome.expectedTpProfit > 0
      ? clamp(realPnl / outcome.expectedTpProfit, 0, 1.5)
      : (win ? 0.8 : 0.2); // heuristic for non-TP exits
    const realizedCapture = ewma(existing.realizedCapture, tradeCapture, alphaFast);

    // EWMA win rate and EV
    const ewmaWinRate = ewma(existing.ewmaWinRate, win ? 1 : 0, alphaFast);
    const ewmaEv = ewma(existing.ewmaEv, outcome.realizedPnl, EWMA_SLOW);
    const ewmaSlippage = ewma(existing.ewmaSlippage ?? existing.avgSlippage ?? 0, slippage, EWMA_SLOW);
    const realEv = ewmaEv - ewmaSlippage;

    // Recompute scores
    const priorityScore = computePriorityScore(winRate, realizedCapture, slHitRate, profitFactor);
    const toxicityScore = computeToxicityScore(winRate, realizedCapture, slHitRate, profitFactor);

    this.clusterProfiles.set(keyStr, {
      ...existing,
      samples: n,
      wins,
      losses,
      winRate,
      avgWin,
      avgLoss,
      ev,
      profitFactor,
      totalPnl: existing.totalPnl + realPnl,
      totalFees: existing.totalFees + outcome.fee,
      totalSlippage: (existing.totalSlippage ?? 0) + slippage,
      avgSlippage: ((existing.totalSlippage ?? 0) + slippage) / n,
      tpHitRate,
      slHitRate,
      realizedCapture,
      priorityScore,
      toxicityScore,
      ewmaWinRate,
      ewmaEv,
      ewmaSlippage,
      realEv,
      lastUpdated: Date.now(),
    });
  }

  private rollupSymbolProfile(symbol: string): void {
    const relevant = Array.from(this.clusterProfiles.values()).filter(
      (p) => p.key.symbol === symbol,
    );
    if (relevant.length === 0) return;

    const totalSamples = relevant.reduce((s, p) => s + p.samples, 0);
    const totalPnl = relevant.reduce((s, p) => s + p.totalPnl, 0);
    const totalFees = relevant.reduce((s, p) => s + p.totalFees, 0);
    const totalSlippage = relevant.reduce((s, p) => s + (p.totalSlippage ?? 0), 0);

    // Weighted aggregation
    const w = (f: (p: ClusterProfile) => number) =>
      relevant.reduce((s, p) => s + f(p) * p.samples, 0) / Math.max(totalSamples, 1);

    const winRate = w((p) => p.winRate);
    const ev = w((p) => p.realEv ?? p.ev);
    const profitFactor = w((p) => Math.min(p.profitFactor, 99));
    const priorityScore = w((p) => p.priorityScore);
    const toxicityScore = w((p) => p.toxicityScore);

    const hourPnl = this.hourProfile();
    const sortedByPnl = hourPnl.filter((h) => h.samples >= 2).sort((a, b) => b.pnl - a.pnl);

    this.symbolProfiles.set(symbolKeyStr(symbol), {
      symbol,
      totalSamples,
      winRate,
      profitFactor,
      ev,
      totalPnl,
      totalFees,
      totalSlippage,
      avgSlippage: totalSlippage / Math.max(totalSamples, 1),
      netPnl: totalPnl,
      isToxic: totalSamples >= MIN_SAMPLES_FOR_GATE && totalPnl < 0,
      bestHour: sortedByPnl[0]?.hour ?? null,
      worstHour: sortedByPnl[sortedByPnl.length - 1]?.hour ?? null,
      priorityScore,
      toxicityScore,
    });
  }

  private rebuildFromOutcomes(outcomes: TradeOutcome[]): void {
    this.outcomes = [];
    this.clusterProfiles.clear();
    this.symbolProfiles.clear();
    this.globalEwmaWinRate = PRIORITY_SCORE_NEUTRAL;
    this.globalEwmaEv = 0;
    this.globalEwmaFee = 0;
    this.totalTrades = 0;
    for (const outcome of outcomes) {
      this.recordOutcome(outcome);
    }
  }
}

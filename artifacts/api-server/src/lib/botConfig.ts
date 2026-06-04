import { getActiveModeId } from "./botModes";

/**
 * Bot configuration — ENV is the source of truth.
 * Runtime overrides (applied via PATCH /api/bot/config) take precedence
 * over ENV values and persist in memory until server restart.
 * Override keys must be a subset of the config object keys.
 */

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envNum(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (!v) return fallback;
  return v.toLowerCase() === "true" || v === "1";
}

function envList(key: string, fallback: string[]): string[] {
  const v = process.env[key];
  if (!v) return fallback;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function envIntList(key: string, fallback: number[]): number[] {
  const v = process.env[key];
  if (!v) return fallback;
  return v.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
}

// ── Runtime overrides ────────────────────────────────────────────────────────
// Stored in-memory. Cleared on server restart (intentional — ENV is the durable truth).

export type ConfigOverrideKey =
  | "leverage"
  | "marginPerTrade"
  | "maxConcurrentPositions"
  | "maxMarginUtilization"
  | "takeProfitPct"
  | "stopLossPct"
  | "evMinThreshold"
  | "winRateMin"
  | "profitFactorMin"
  | "btcRegimeRequired"
  | "btcRegimeThresholdPct"
  | "allowedSymbols"
  | "hourBlacklist"
  | "orderType"
  | "marginType"
  | "allowExecution"
  | "maxSessionLoss";

type OverrideStore = Partial<Record<ConfigOverrideKey, unknown>>;

const _overrides: OverrideStore = {};

export function setConfigOverrides(patch: OverrideStore): void {
  Object.assign(_overrides, patch);
}

export function resetConfigOverrides(): void {
  for (const key of Object.keys(_overrides) as ConfigOverrideKey[]) {
    delete _overrides[key];
  }
}

export function getConfigOverrides(): OverrideStore {
  return { ..._overrides };
}

function ov<T>(key: ConfigOverrideKey, envValue: T): T {
  return key in _overrides ? (_overrides[key] as T) : envValue;
}

// ── Config reader ────────────────────────────────────────────────────────────

export function getBotConfig() {
  return {
    leverage:               ov("leverage",               envNum("SCALP_LEVERAGE", 14)),
    marginPerTrade:         ov("marginPerTrade",         envNum("SCALP_MARGIN_PER_TRADE", 5)),
    maxConcurrentPositions: ov("maxConcurrentPositions", envNum("SCALP_MAX_CONCURRENT_POSITIONS", 10)),
    maxMarginUtilization:   ov("maxMarginUtilization",   envNum("SCALP_MAX_MARGIN_UTILIZATION", 0.5)),
    takeProfitPct:          ov("takeProfitPct",          envNum("SCALP_TAKE_PROFIT_PCT", 0.15)),
    stopLossPct:            ov("stopLossPct",            envNum("SCALP_STOP_LOSS_PCT", 0.10)),
    evMinThreshold:         ov("evMinThreshold",         envNum("SCALP_EV_MIN_THRESHOLD", 0.0)),
    winRateMin:             ov("winRateMin",             envNum("SCALP_WIN_RATE_MIN", 0.0)),
    profitFactorMin:        ov("profitFactorMin",        envNum("SCALP_PROFIT_FACTOR_MIN", 0.0)),
    btcRegimeRequired:      ov("btcRegimeRequired",      envBool("SCALP_BTC_REGIME_REQUIRED", false)),
    btcRegimeThresholdPct:  ov("btcRegimeThresholdPct",  envNum("SCALP_BTC_REGIME_THRESHOLD_PCT", 0.5)),
    allowedSymbols:         ov("allowedSymbols",         envList("SCALP_SYMBOLS", [])),
    hourBlacklist:          ov("hourBlacklist",          envIntList("SCALP_HOUR_BLACKLIST", [])),
    orderType:              ov("orderType",              env("SCALP_ORDER_TYPE", "MARKET")),
    marginType:             ov("marginType",             env("SCALP_MARGIN_TYPE", "ISOLATED")),
    allowExecution:         ov("allowExecution",         envBool("SCALP_ALLOW_EXECUTION", false)),
    maxSessionLoss:         ov("maxSessionLoss",         envNum("SCALP_MAX_SESSION_LOSS", 20)),
    loadedAt:               new Date().toISOString(),
    hasOverrides:           Object.keys(_overrides).length > 0,
    activeOverrides:        Object.keys(_overrides) as ConfigOverrideKey[],
    activeMode:             getActiveModeId() ?? null,
  };
}

export type BotConfig = ReturnType<typeof getBotConfig>;

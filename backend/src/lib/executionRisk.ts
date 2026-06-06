import type { BotConfig } from "./botConfig";

const DEFAULT_TAKER_FEE_RATE = 0.0005;
const FEE_DRAG_BUFFER_MULTIPLIER = 1.5;
const DEFAULT_MAX_CORRELATED_BULK_ORDERS = 3;

export interface ExecutionCostEstimate {
  notional: number;
  roundTripFee: number;
  feeDragPctOfMargin: number;
  minExpectedPnl: number;
}

function envNum(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function takerFeeRate(): number {
  return envNum("SCALP_TAKER_FEE_RATE", DEFAULT_TAKER_FEE_RATE);
}

export function feeDragBufferMultiplier(): number {
  return envNum("SCALP_FEE_DRAG_BUFFER_MULTIPLIER", FEE_DRAG_BUFFER_MULTIPLIER);
}

export function maxCorrelatedBulkOrders(): number {
  return Math.max(1, Math.floor(envNum("SCALP_MAX_CORRELATED_BULK_ORDERS", DEFAULT_MAX_CORRELATED_BULK_ORDERS)));
}

export function estimateExecutionCosts(
  marginUsed: number,
  leverage: number,
  feeRate = takerFeeRate(),
  bufferMultiplier = feeDragBufferMultiplier(),
): ExecutionCostEstimate {
  const safeMargin = Math.max(0, marginUsed);
  const safeLeverage = Math.max(0, leverage);
  const notional = safeMargin * safeLeverage;
  const roundTripFee = notional * feeRate * 2;
  const feeDragPctOfMargin = safeMargin > 0 ? roundTripFee / safeMargin : 0;
  return {
    notional,
    roundTripFee,
    feeDragPctOfMargin,
    minExpectedPnl: roundTripFee * bufferMultiplier,
  };
}

export function estimateOrderMargin(config: BotConfig, quantity?: number, price?: number | null): number {
  if (quantity && quantity > 0 && price && price > 0) {
    return (quantity * price) / config.leverage;
  }
  return config.marginPerTrade;
}

export function feeDragRejectReason(currentEv: number | undefined, marginUsed: number, config: BotConfig): string | null {
  if (currentEv === undefined) return null;
  const costs = estimateExecutionCosts(marginUsed, config.leverage);
  if (currentEv >= costs.minExpectedPnl) return null;
  return `FEE_DRAG_REJECT: EV ${currentEv.toFixed(4)} < fee buffer ${costs.minExpectedPnl.toFixed(4)} (${(costs.feeDragPctOfMargin * 100).toFixed(2)}% margin drag)`;
}

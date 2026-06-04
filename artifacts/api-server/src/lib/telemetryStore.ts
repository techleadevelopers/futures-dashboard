/**
 * Telemetry Store — persistent trade outcome log with adaptive engine integration.
 *
 * Storage: append-only JSONL file (one JSON object per line).
 * Equivalent to the Postgres/SQLite storage in the MEV runtime, but lighter.
 *
 * On startup: loads all records from disk → rebuilds EWMA state in AdaptiveEngine.
 * On each new trade: appends to JSONL file + updates engine in-memory.
 *
 * This design matches the MEV "rollup-first storage model" — high-frequency telemetry
 * is kept as minimal records, not raw order blobs. Profiles are recomputed in-memory.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { AdaptiveEngine, type TradeOutcome, type BtcRegime, type PositionSide, type ExitReason } from "./adaptiveEngine";

const TELEMETRY_FILE = path.join(process.cwd(), "telemetry.jsonl");

let engine: AdaptiveEngine;
let fileStream: fs.WriteStream | null = null;

function loadFromDisk(): TradeOutcome[] {
  if (!fs.existsSync(TELEMETRY_FILE)) return [];
  try {
    const lines = fs.readFileSync(TELEMETRY_FILE, "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    return lines.map((l) => JSON.parse(l) as TradeOutcome).filter(Boolean);
  } catch {
    return [];
  }
}

function appendToDisk(outcome: TradeOutcome): void {
  if (!fileStream || fileStream.destroyed) {
    fileStream = fs.createWriteStream(TELEMETRY_FILE, { flags: "a", encoding: "utf-8" });
  }
  fileStream.write(JSON.stringify(outcome) + "\n");
}

/** Initialize the store — call once at server startup */
export function initTelemetryStore(): AdaptiveEngine {
  const historical = loadFromDisk();
  engine = new AdaptiveEngine(historical);
  return engine;
}

/** Get the live adaptive engine — always available after init */
export function getEngine(): AdaptiveEngine {
  if (!engine) engine = new AdaptiveEngine([]);
  return engine;
}

/**
 * Record a realized trade outcome.
 * Persists to disk AND updates in-memory EWMA state immediately.
 * Equivalent to the storage.record_outcome() + adaptive.apply_outcome() pipeline.
 */
export function recordTradeOutcome(raw: Omit<TradeOutcome, "id"> & { id?: string }): TradeOutcome {
  const outcome: TradeOutcome = {
    id: raw.id ?? crypto.randomUUID(),
    ...raw,
    hourUtc: raw.hourUtc ?? new Date(raw.entryTime).getUTCHours(),
  };
  appendToDisk(outcome);
  getEngine().recordOutcome(outcome);
  return outcome;
}

/**
 * Reconstruct a TradeOutcome from a BingX order pair (entry + exit orders).
 * Converts raw BingX order data to the telemetry schema.
 */
export function buildOutcomeFromOrders(
  entryOrder: {
    orderId: string;
    symbol: string;
    side: string;
    positionSide: string;
    avgPrice: string;
    origQty: string;
    commission?: string | null;
    time: number;
  },
  exitOrder: {
    avgPrice: string;
    commission?: string | null;
    profit?: string | null;
    time: number;
  },
  context: {
    btcRegime: BtcRegime;
    leverage: number;
    marginUsed: number;
    expectedTpProfit: number;
    exitReason: ExitReason;
  },
): TradeOutcome {
  const grossPnl = parseFloat(exitOrder.profit ?? "0");
  const entryFee = Math.abs(parseFloat(entryOrder.commission ?? "0"));
  const exitFee = Math.abs(parseFloat(exitOrder.commission ?? "0"));
  const fee = entryFee + exitFee;
  const realizedPnl = grossPnl - fee;
  const entryPrice = parseFloat(entryOrder.avgPrice);
  const exitPrice = parseFloat(exitOrder.avgPrice);
  const qty = parseFloat(entryOrder.origQty);

  return {
    id: entryOrder.orderId,
    symbol: entryOrder.symbol,
    positionSide: entryOrder.positionSide as PositionSide,
    side: entryOrder.side as "BUY" | "SELL",
    entryTime: entryOrder.time,
    exitTime: exitOrder.time,
    hourUtc: new Date(entryOrder.time).getUTCHours(),
    btcRegime: context.btcRegime,
    entryPrice,
    exitPrice,
    qty,
    leverage: context.leverage,
    marginUsed: context.marginUsed,
    grossPnl,
    fee,
    realizedPnl,
    exitReason: context.exitReason,
    expectedTpProfit: context.expectedTpProfit,
  };
}

/** Export all raw outcomes (for backup or external analysis) */
export function exportAllOutcomes(): TradeOutcome[] {
  return getEngine().rawOutcomes();
}

/** How many trades are in the telemetry store */
export function tradeCount(): number {
  return getEngine().globalState().totalTrades;
}

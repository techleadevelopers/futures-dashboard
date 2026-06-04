import { Router } from "express";
import type { Request, Response } from "express";
import {
  getEngine,
  recordTradeOutcome,
  exportAllOutcomes,
  tradeCount,
} from "../lib/telemetryStore";
import type { BtcRegime, ExitReason, PositionSide } from "../lib/adaptiveEngine";

const router = Router();

/** GET /api/telemetry/state — full adaptive engine state for dashboard */
router.get("/telemetry/state", (_req: Request, res: Response) => {
  const engine = getEngine();
  const global = engine.globalState();
  res.json({
    totalTrades: global.totalTrades,
    ewmaWinRate: global.ewmaWinRate,
    ewmaEv: global.ewmaEv,
    ewmaFeePerTrade: global.ewmaFeePerTrade,
    symbolProfiles: engine.allSymbolProfiles(),
    clusterProfiles: engine.allClusterProfiles(),
    hourProfile: engine.hourProfile(),
    gateRecommendation: engine.gateRecommendation(),
  });
});

/** GET /api/telemetry/recommendation — adaptive gate recommendation only */
router.get("/telemetry/recommendation", (_req: Request, res: Response) => {
  res.json(getEngine().gateRecommendation());
});

/** POST /api/telemetry/outcome — record a realized trade outcome */
router.post("/telemetry/outcome", (req: Request, res: Response) => {
  const body = req.body as {
    id?: string;
    symbol: string;
    positionSide: PositionSide;
    side: "BUY" | "SELL";
    entryTime: number;
    exitTime: number;
    hourUtc?: number;
    btcRegime: BtcRegime;
    entryPrice: number;
    exitPrice: number;
    qty: number;
    leverage: number;
    marginUsed: number;
    grossPnl: number;
    fee: number;
    realizedPnl: number;
    exitReason: ExitReason;
    expectedTpProfit: number;
  };

  if (!body.symbol || body.entryPrice == null || body.exitPrice == null || body.realizedPnl == null) {
    res.status(400).json({ error: "symbol, entryPrice, exitPrice, realizedPnl are required" });
    return;
  }

  try {
    const outcome = recordTradeOutcome({
      ...body,
      hourUtc: body.hourUtc ?? new Date(body.entryTime).getUTCHours(),
    });
    req.log.info({ symbol: outcome.symbol, pnl: outcome.realizedPnl, side: outcome.positionSide }, "telemetry outcome recorded");
    res.json({ recorded: true, id: outcome.id, totalTrades: tradeCount() });
  } catch (err) {
    req.log.error({ err }, "telemetry record error");
    res.status(500).json({ error: "Failed to record outcome" });
  }
});

/**
 * GET /api/telemetry/context — ContextSignal for a specific cluster.
 * Equivalent to adaptive_policy.context_signal(router, hour_utc) in Rust.
 * Frontend sends this before each potential entry to get priority/toxicity scores.
 */
router.get("/telemetry/context", (req: Request, res: Response) => {
  const { symbol, positionSide, hourUtc, btcRegime } = req.query as {
    symbol: string;
    positionSide: string;
    hourUtc: string;
    btcRegime: string;
  };
  if (!symbol || !positionSide || hourUtc == null || !btcRegime) {
    res.status(400).json({ error: "symbol, positionSide, hourUtc, btcRegime are required" });
    return;
  }
  const signal = getEngine().contextSignal({
    symbol,
    positionSide: positionSide as PositionSide,
    hourUtc: parseInt(hourUtc, 10),
    btcRegime: btcRegime as BtcRegime,
  });
  res.json(signal);
});

/** GET /api/telemetry/rank — ranking score for a pending entry */
router.get("/telemetry/rank", (req: Request, res: Response) => {
  const { symbol, positionSide, hourUtc, btcRegime, currentEv } = req.query as Record<string, string>;
  if (!symbol || !positionSide || hourUtc == null || !btcRegime || currentEv == null) {
    res.status(400).json({ error: "symbol, positionSide, hourUtc, btcRegime, currentEv are required" });
    return;
  }
  const score = getEngine().rankingScore(
    { symbol, positionSide: positionSide as PositionSide, hourUtc: parseInt(hourUtc, 10), btcRegime: btcRegime as BtcRegime },
    parseFloat(currentEv),
  );
  const signal = getEngine().contextSignal({
    symbol,
    positionSide: positionSide as PositionSide,
    hourUtc: parseInt(hourUtc, 10),
    btcRegime: btcRegime as BtcRegime,
  });
  res.json({ rankingScore: score, ...signal });
});

/** GET /api/telemetry/export — raw JSONL export of all outcomes */
router.get("/telemetry/export", (_req: Request, res: Response) => {
  res.json(exportAllOutcomes());
});

export default router;

import { Router } from "express";
import { createHmac } from "crypto";
import type { Request, Response } from "express";
import { getBotConfig } from "../lib/botConfig";
import { getEngine } from "../lib/telemetryStore";
import type { BtcRegime, ClusterKey, PositionSide } from "../lib/adaptiveEngine";

declare module "express-session" {
  interface SessionData {
    demoApiKey?: string;
    demoSecretKey?: string;
  }
}

const router = Router();

// VST (demo) usa endpoint diferente da conta real
const BINGX_BASE = "https://open-api-vst.bingx.com";

function sign(params: Record<string, string | number | undefined>, secretKey: string): string {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return createHmac("sha256", secretKey).update(query).digest("hex");
}

async function bingxGet(
  path: string,
  params: Record<string, string | number | undefined>,
  apiKey: string,
  secretKey: string,
): Promise<Record<string, unknown>> {
  const timestamp = Date.now();
  const allParams = { ...params, timestamp };
  const signature = sign(allParams, secretKey);
  const qs = Object.entries(allParams)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${BINGX_BASE}${path}?${qs}&signature=${signature}`;
  const res = await fetch(url, { headers: { "X-BX-APIKEY": apiKey } });
  return res.json() as Promise<Record<string, unknown>>;
}

async function bingxPost(
  path: string,
  params: Record<string, string | number | undefined>,
  apiKey: string,
  secretKey: string,
): Promise<Record<string, unknown>> {
  const timestamp = Date.now();
  const allParams = { ...params, timestamp };
  const signature = sign(allParams, secretKey);
  const qs = Object.entries(allParams)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${BINGX_BASE}${path}?${qs}&signature=${signature}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-BX-APIKEY": apiKey },
  });
  return res.json() as Promise<Record<string, unknown>>;
}

function getDemoCredentials(req: Request): { apiKey: string; secretKey: string } | null {
  const { demoApiKey, demoSecretKey } = req.session;
  if (!demoApiKey || !demoSecretKey) return null;
  return { apiKey: demoApiKey, secretKey: demoSecretKey };
}

async function fetchDemoBalance(apiKey: string, secretKey: string) {
  const data = await bingxGet("/openApi/swap/v2/user/balance", {}, apiKey, secretKey);
  if (data.code !== 0) return null;
  const bal = ((data.data as Record<string, unknown>)?.balance ?? {}) as Record<string, string>;
  return bal;
}

/** POST /api/demo/connect — usa as credenciais já salvas na sessão principal */
router.post("/demo/connect", async (req: Request, res: Response) => {
  // Reutiliza as credenciais da conta real já autenticadas (mesmas chaves, endpoint VST)
  const { bingxApiKey, bingxSecretKey } = req.session as { bingxApiKey?: string; bingxSecretKey?: string };

  if (!bingxApiKey || !bingxSecretKey) {
    res.status(401).json({ connected: false, error: "Conecte sua conta BingX primeiro na aba principal antes de ativar o modo demo." });
    return;
  }

  try {
    const bal = await fetchDemoBalance(bingxApiKey, bingxSecretKey);
    if (!bal) {
      res.status(401).json({ connected: false, error: "Conta demo VST não acessível com essas credenciais. Verifique se a conta demo está ativada no app BingX." });
      return;
    }

    req.session.demoApiKey = bingxApiKey;
    req.session.demoSecretKey = bingxSecretKey;

    const posData = await bingxGet("/openApi/swap/v2/user/positions", {}, bingxApiKey, bingxSecretKey);
    const positions = posData.code === 0 ? ((posData.data as unknown[]) ?? []) as Record<string, unknown>[] : [];
    const openPositionsCount = positions.filter((p) => parseFloat(String(p.positionAmt ?? "0")) !== 0).length;

    res.json({
      connected: true,
      balance: bal.balance ?? "0",
      availableBalance: bal.availableMargin ?? "0",
      unrealizedPnl: bal.unrealizedProfit ?? "0",
      openPositionsCount,
      currency: bal.asset ?? "VST",
    });
  } catch (err) {
    req.log.error({ err }, "demo connect error");
    res.status(500).json({ connected: false, error: "Falha ao conectar ao servidor VST" });
  }
});

/** POST /api/demo/disconnect */
router.post("/demo/disconnect", (req: Request, res: Response) => {
  req.session.demoApiKey = undefined;
  req.session.demoSecretKey = undefined;
  res.json({ disconnected: true });
});

/** GET /api/demo/status */
router.get("/demo/status", async (req: Request, res: Response) => {
  const creds = getDemoCredentials(req);
  if (!creds) {
    res.json({ connected: false });
    return;
  }

  try {
    const [balData, posData] = await Promise.all([
      bingxGet("/openApi/swap/v2/user/balance", {}, creds.apiKey, creds.secretKey),
      bingxGet("/openApi/swap/v2/user/positions", {}, creds.apiKey, creds.secretKey),
    ]);

    if (balData.code !== 0) {
      res.json({ connected: false, error: "Could not fetch demo balance" });
      return;
    }

    const bal = ((balData.data as Record<string, unknown>)?.balance ?? {}) as Record<string, string>;
    const positions = posData.code === 0 ? ((posData.data as unknown[]) ?? []) as Record<string, unknown>[] : [];
    const openPositionsCount = positions.filter((p) => parseFloat(String(p.positionAmt ?? "0")) !== 0).length;

    res.json({
      connected: true,
      balance: bal.balance ?? "0",
      availableBalance: bal.availableMargin ?? "0",
      unrealizedPnl: bal.unrealizedProfit ?? "0",
      openPositionsCount,
      currency: bal.asset ?? "VST",
    });
  } catch (err) {
    req.log.error({ err }, "demo status error");
    res.json({ connected: false, error: "Status fetch failed" });
  }
});

/** POST /api/demo/order — gate evaluation + optional demo execution */
router.post("/demo/order", async (req: Request, res: Response) => {
  const creds = getDemoCredentials(req);
  if (!creds) {
    res.status(401).json({ error: "Demo not connected. Connect your VST account first." });
    return;
  }

  const config = getBotConfig();
  const {
    symbol,
    side,
    positionSide,
    quantity,
    currentEv,
    currentWinRate,
    currentProfitFactor,
    btcChangePct,
    execute,
  } = req.body as {
    symbol: string;
    side: "BUY" | "SELL";
    positionSide: "LONG" | "SHORT";
    quantity?: number;
    currentEv?: number;
    currentWinRate?: number;
    currentProfitFactor?: number;
    btcChangePct?: number;
    execute?: boolean;
  };

  if (!symbol || !side || !positionSide) {
    res.status(400).json({ error: "symbol, side, and positionSide are required" });
    return;
  }

  const gateRejects: string[] = [];
  const currentHour = new Date().getUTCHours();

  if (config.allowedSymbols.length > 0 && !config.allowedSymbols.includes(symbol)) {
    gateRejects.push(`SYMBOL_REJECT: ${symbol} not in allowlist`);
  }

  if (config.hourBlacklist.includes(currentHour)) {
    gateRejects.push(`HOUR_REJECT: UTC hour ${currentHour} is blacklisted`);
  }

  if (config.btcRegimeRequired && btcChangePct !== undefined) {
    const absChange = Math.abs(btcChangePct);
    if (absChange < config.btcRegimeThresholdPct) {
      gateRejects.push(`REGIME_REJECT: BTC ${btcChangePct.toFixed(2)}% < ±${config.btcRegimeThresholdPct}%`);
    } else {
      const btcBull = btcChangePct > 0;
      const wantLong = positionSide === "LONG";
      if (btcBull !== wantLong) {
        gateRejects.push(`REGIME_DIRECTION: BTC ${btcBull ? "BULL" : "BEAR"} vs ${positionSide}`);
      }
    }
  }

  if (config.evMinThreshold > 0 && currentEv !== undefined && currentEv < config.evMinThreshold) {
    gateRejects.push(`EV_REJECT: EV ${currentEv.toFixed(4)} < ${config.evMinThreshold.toFixed(4)}`);
  }

  if (config.winRateMin > 0 && currentWinRate !== undefined && currentWinRate < config.winRateMin) {
    gateRejects.push(`WR_REJECT: WR ${(currentWinRate * 100).toFixed(1)}% < ${(config.winRateMin * 100).toFixed(1)}%`);
  }

  if (config.profitFactorMin > 0 && currentProfitFactor !== undefined && currentProfitFactor < config.profitFactorMin) {
    gateRejects.push(`PF_REJECT: PF ${currentProfitFactor.toFixed(2)}x < ${config.profitFactorMin.toFixed(2)}x`);
  }

  let openPositionsCount = 0;
  let marginUtilization = 0;
  try {
    const [posData, balData] = await Promise.all([
      bingxGet("/openApi/swap/v2/user/positions", {}, creds.apiKey, creds.secretKey),
      bingxGet("/openApi/swap/v2/user/balance", {}, creds.apiKey, creds.secretKey),
    ]);
    if (posData.code === 0) {
      const positions = ((posData.data as unknown[]) ?? []) as Record<string, unknown>[];
      openPositionsCount = positions.filter((p) => parseFloat(String(p.positionAmt ?? "0")) !== 0).length;
    }
    if (balData.code === 0) {
      const bal = ((balData.data as Record<string, unknown>)?.balance ?? {}) as Record<string, string>;
      const usedMargin = parseFloat(bal.usedMargin ?? "0");
      const equity = parseFloat(bal.equity ?? "1");
      marginUtilization = equity > 0 ? usedMargin / equity : 0;
    }
  } catch {
    // non-fatal
  }

  if (openPositionsCount >= config.maxConcurrentPositions) {
    gateRejects.push(`CAPITAL_REJECT: ${openPositionsCount} positions >= max ${config.maxConcurrentPositions}`);
  }
  if (marginUtilization > config.maxMarginUtilization) {
    gateRejects.push(`MARGIN_REJECT: ${(marginUtilization * 100).toFixed(1)}% > max ${(config.maxMarginUtilization * 100).toFixed(0)}%`);
  }

  if (!execute || gateRejects.length > 0) {
    const mode = !execute ? "observation" : "gate_reject";
    req.log.info({ symbol, side, positionSide, gateRejects, mode }, "demo order eval");
    res.status(gateRejects.length > 0 ? 403 : 200).json({
      placed: false,
      orderId: null,
      symbol,
      side,
      quantity: quantity ?? null,
      gateRejects,
      observationMode: !execute,
      message: gateRejects.length > 0
        ? `BLOCKED by ${gateRejects.length} gate(s): ${gateRejects[0]}`
        : "All gates pass. Observation mode — set execute=true to fire on demo account.",
    });
    return;
  }

  let qty = quantity;
  if (!qty) {
    try {
      const url = `${BINGX_BASE}/openApi/swap/v2/quote/ticker?symbol=${encodeURIComponent(symbol)}`;
      const tickerData = (await (await fetch(url)).json()) as Record<string, unknown>;
      if (tickerData.code === 0) {
        const t = (tickerData.data as Record<string, string>) ?? {};
        const markPrice = parseFloat(t.lastPrice ?? "0");
        if (markPrice > 0) {
          qty = (config.marginPerTrade * config.leverage) / markPrice;
          qty = Math.floor(qty * 1000) / 1000;
        }
      }
    } catch {
      // use fallback
    }
  }

  if (!qty || qty <= 0) {
    res.status(400).json({
      placed: false,
      orderId: null,
      symbol,
      side,
      quantity: null,
      gateRejects: ["QTY_REJECT: could not compute valid quantity"],
      observationMode: false,
      message: "Could not determine order quantity.",
    });
    return;
  }

  try {
    const data = await bingxPost(
      "/openApi/swap/v2/trade/order",
      { symbol, side, positionSide, type: config.orderType, quantity: qty, leverage: config.leverage },
      creds.apiKey,
      creds.secretKey,
    );

    if (data.code !== 0) {
      req.log.error({ data }, "demo order BingX error");
      res.status(500).json({
        placed: false,
        orderId: null,
        symbol,
        side,
        quantity: qty,
        gateRejects: [],
        observationMode: false,
        message: `BingX error: ${(data.msg as string) ?? "unknown"}`,
      });
      return;
    }

    const order = (data.data as Record<string, unknown>)?.order as Record<string, unknown>;
    req.log.info({ symbol, side, positionSide, qty, orderId: order?.orderId }, "demo order placed");
    res.json({
      placed: true,
      orderId: String(order?.orderId ?? ""),
      symbol,
      side,
      quantity: qty,
      gateRejects: [],
      observationMode: false,
      message: `Demo order placed: ${side} ${qty} ${symbol} @ MARKET`,
    });
  } catch (err) {
    req.log.error({ err }, "demo order error");
    res.status(500).json({ error: "Demo order execution failed" });
  }
});

/** POST /api/demo/close */
router.post("/demo/close", async (req: Request, res: Response) => {
  const creds = getDemoCredentials(req);
  if (!creds) {
    res.status(401).json({ error: "Demo not connected." });
    return;
  }

  const { symbol, positionSide, quantity } = req.body as {
    symbol: string;
    positionSide: "LONG" | "SHORT";
    quantity: string;
  };

  if (!symbol || !positionSide || !quantity) {
    res.status(400).json({ error: "symbol, positionSide, and quantity are required" });
    return;
  }

  const closeSide = positionSide === "LONG" ? "SELL" : "BUY";

  try {
    const data = await bingxPost(
      "/openApi/swap/v2/trade/order",
      { symbol, side: closeSide, positionSide, type: "MARKET", quantity: parseFloat(quantity) },
      creds.apiKey,
      creds.secretKey,
    );

    if (data.code !== 0) {
      res.status(500).json({
        placed: false,
        orderId: null,
        symbol,
        side: closeSide,
        quantity: parseFloat(quantity),
        gateRejects: [],
        observationMode: false,
        message: `BingX error: ${(data.msg as string) ?? "unknown"}`,
      });
      return;
    }

    const order = (data.data as Record<string, unknown>)?.order as Record<string, unknown>;
    res.json({
      placed: true,
      orderId: String(order?.orderId ?? ""),
      symbol,
      side: closeSide,
      quantity: parseFloat(quantity),
      gateRejects: [],
      observationMode: false,
      message: `Demo close placed: ${closeSide} ${quantity} ${symbol}`,
    });
  } catch (err) {
    req.log.error({ err }, "demo close error");
    res.status(500).json({ error: "Demo close failed" });
  }
});

export { router as demoRouter };
export default router;

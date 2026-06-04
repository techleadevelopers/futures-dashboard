import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  useGetBingXTicker,
  useGetBotConfig,
  useGetBotScan,
  useGetDemoStatus,
  useConnectDemo,
  useDisconnectDemo,
  usePlaceDemoOrder,
  useCloseDemoPosition,
  getGetBingXTickerQueryKey,
  getGetBotConfigQueryKey,
  getGetBotScanQueryKey,
  getGetDemoStatusQueryKey,
} from "@workspace/api-client-react";
import AppShell from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  FlaskConical, ShieldCheck, ShieldOff,
  Zap, Radio, CheckCircle2, XCircle, ArrowRight, Loader2,
  TrendingUp, TrendingDown, DollarSign, LogOut, Play, Square,
  Clock, Target, AlertTriangle, RefreshCw,
} from "lucide-react";

interface LogEntry {
  id: string;
  ts: number;
  symbol: string;
  positionSide: "LONG" | "SHORT";
  placed: boolean;
  observationMode: boolean;
  gateRejects: string[];
  message: string;
  orderId?: string | null;
}

function GateTag({ reject }: { reject: string }) {
  const label = reject.split(":")[0];
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono bg-red-500/10 text-red-400 border border-red-500/20">
      {label}
    </span>
  );
}

function ScanRow({
  symbol, positionSide, lastPrice, priceChangePct, gatePass, gateRejects,
  isToxic, isCandidate, ev, ewmaWinRate, samples,
  autoFire, onFire, firing,
}: {
  symbol: string; positionSide: string; lastPrice: string; priceChangePct: number;
  gatePass: boolean; gateRejects: string[]; isToxic: boolean; isCandidate: boolean;
  ev: number; ewmaWinRate: number; samples: number;
  autoFire: boolean; onFire: () => void; firing: boolean;
}) {
  const short = symbol.replace("-USDT", "").replace("-USD", "");
  const up = priceChangePct >= 0;

  const statusColor = isToxic ? "text-red-400"
    : isCandidate ? "text-green-400"
    : gatePass ? "text-yellow-400"
    : "text-muted-foreground";

  const statusLabel = isToxic ? "TOXIC"
    : isCandidate ? "READY"
    : gatePass ? "PASS"
    : "BLOCKED";

  return (
    <div className={`px-4 py-3 border-b border-border/15 last:border-0 transition-colors ${isCandidate && autoFire ? "bg-green-500/5" : ""}`}>
      <div className="flex items-center gap-3">
        {/* Symbol + side */}
        <div className="w-28 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              isToxic ? "bg-red-500" : isCandidate ? "bg-green-400 animate-pulse" : gatePass ? "bg-yellow-400" : "bg-muted-foreground/40"
            }`} />
            <span className="text-xs font-bold">{short}</span>
            <span className={`text-[10px] font-mono ml-0.5 ${positionSide === "LONG" ? "text-green-400" : "text-red-400"}`}>
              {positionSide === "LONG" ? "▲L" : "▼S"}
            </span>
          </div>
          <div className={`text-[10px] font-mono mt-0.5 ${up ? "text-green-400" : "text-red-400"}`}>
            {up ? "+" : ""}{priceChangePct.toFixed(2)}%
          </div>
        </div>

        {/* Gate status */}
        <div className="flex-1 min-w-0">
          {isCandidate ? (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
              <span className="text-[10px] text-green-400 font-semibold">All gates pass</span>
              {samples > 0 && (
                <span className="text-[9px] text-muted-foreground font-mono ml-1">
                  WR {(ewmaWinRate * 100).toFixed(0)}% · EV {ev.toFixed(3)}
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1 items-center">
              {gateRejects.slice(0, 3).map((r, i) => <GateTag key={i} reject={r} />)}
              {gateRejects.length > 3 && (
                <span className="text-[9px] text-muted-foreground">+{gateRejects.length - 3}</span>
              )}
            </div>
          )}
        </div>

        {/* Status badge */}
        <span className={`text-[10px] font-bold font-mono shrink-0 w-14 text-right ${statusColor}`}>
          {statusLabel}
        </span>

        {/* Fire button */}
        <Button
          size="sm"
          variant={isCandidate ? "default" : "outline"}
          disabled={!isCandidate || firing}
          onClick={onFire}
          className={`h-7 px-2.5 text-[11px] shrink-0 ${isCandidate ? "bg-green-600 hover:bg-green-500 text-white" : "opacity-30"}`}
        >
          {firing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          {!firing && <span className="ml-1">Fire</span>}
        </Button>
      </div>
    </div>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const time = new Date(entry.ts).toLocaleTimeString("en-US", { hour12: false });
  const short = entry.symbol.replace("-USDT", "");
  return (
    <div className={`px-4 py-2.5 border-b border-border/10 last:border-0 flex items-start gap-3 ${
      entry.placed ? "bg-green-500/5" : entry.observationMode ? "" : "bg-red-500/5"
    }`}>
      <span className="text-[10px] font-mono text-muted-foreground shrink-0 mt-0.5 w-16">{time}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold">{short}</span>
          <span className={`text-[10px] font-mono ${entry.positionSide === "LONG" ? "text-green-400" : "text-red-400"}`}>
            {entry.positionSide}
          </span>
          {entry.placed ? (
            <span className="text-[10px] bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded font-semibold">FILLED</span>
          ) : entry.observationMode ? (
            <span className="text-[10px] bg-muted/40 text-muted-foreground px-1.5 py-0.5 rounded">OBS</span>
          ) : (
            <span className="text-[10px] bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded font-semibold">BLOCKED</span>
          )}
          {entry.orderId && (
            <span className="text-[9px] font-mono text-muted-foreground truncate">#{entry.orderId}</span>
          )}
        </div>
        {entry.gateRejects.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {entry.gateRejects.map((r, i) => <GateTag key={i} reject={r} />)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DemoPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [autoFire, setAutoFire] = useState(false);
  const [firingSet, setFiringSet] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const { data: btcTicker } = useGetBingXTicker(
    { symbol: "BTC-USDT" },
    { query: { refetchInterval: 5000, queryKey: getGetBingXTickerQueryKey({ symbol: "BTC-USDT" }) } }
  );

  const { data: config } = useGetBotConfig({
    query: { queryKey: getGetBotConfigQueryKey(), refetchInterval: 60000 },
  });

  const { data: demoStatus, refetch: refetchStatus } = useGetDemoStatus({
    query: { queryKey: getGetDemoStatusQueryKey(), refetchInterval: 15000 },
  });

  const btcChange = btcTicker ? parseFloat(btcTicker.priceChangePercent) : 0;

  const { data: scan } = useGetBotScan(
    { btcChangePct: btcChange },
    {
      query: {
        queryKey: getGetBotScanQueryKey({ btcChangePct: btcChange }),
        refetchInterval: 8000,
        enabled: !!(demoStatus?.connected && (config?.allowedSymbols?.length ?? 0) > 0),
      },
    }
  );

  const connectMutation = useConnectDemo();
  const disconnectMutation = useDisconnectDemo();
  const orderMutation = usePlaceDemoOrder();
  const closeMutation = useCloseDemoPosition();

  const demoConnected = demoStatus?.connected ?? false;

  const btcRegime = btcChange >= (config?.btcRegimeThresholdPct ?? 0.5) ? "BULL"
    : btcChange <= -(config?.btcRegimeThresholdPct ?? 0.5) ? "BEAR"
    : "NEUTRAL";

  function addLog(entry: Omit<LogEntry, "id" | "ts">) {
    setLog(prev => [{
      id: `${Date.now()}-${Math.random()}`,
      ts: Date.now(),
      ...entry,
    }, ...prev].slice(0, 200));
  }

  function handleConnect() {
    connectMutation.mutate(
      undefined,
      {
        onSuccess: (data) => {
          if (data.connected) {
            toast({ title: "Demo VST ativado", description: `Balance: ${data.balance ?? "?"} ${data.currency ?? "VST"}` });
            refetchStatus();
          } else {
            toast({ title: "Falha ao conectar", description: data.error ?? "Verifique se sua conta BingX está conectada", variant: "destructive" });
          }
        },
        onError: () => toast({ title: "Erro", description: "Não foi possível ativar o modo demo", variant: "destructive" }),
      }
    );
  }

  function handleDisconnect() {
    setAutoFire(false);
    disconnectMutation.mutate(undefined, {
      onSuccess: () => { toast({ title: "Demo disconnected" }); refetchStatus(); },
    });
  }

  function fireDemoOrder(
    symbol: string,
    positionSide: "LONG" | "SHORT",
    ev: number,
    ewmaWinRate: number,
    execute: boolean,
  ) {
    const side = positionSide === "LONG" ? "BUY" as const : "SELL" as const;
    const key = `${symbol}-${positionSide}`;
    setFiringSet(prev => new Set(prev).add(key));

    orderMutation.mutate(
      {
        data: {
          symbol,
          side,
          positionSide,
          currentEv: ev,
          currentWinRate: ewmaWinRate,
          btcChangePct: btcChange,
          execute,
        },
      },
      {
        onSuccess: (result) => {
          addLog({ symbol, positionSide, placed: result.placed, observationMode: result.observationMode, gateRejects: result.gateRejects, message: result.message, orderId: result.orderId });
          if (result.placed) {
            toast({ title: `Demo order placed`, description: `${positionSide} ${symbol}` });
            refetchStatus();
          }
        },
        onError: () => addLog({ symbol, positionSide, placed: false, observationMode: false, gateRejects: ["REQUEST_ERROR"], message: "Request failed" }),
        onSettled: () => setFiringSet(prev => { const s = new Set(prev); s.delete(key); return s; }),
      }
    );
  }

  const autoFireRef = useRef(autoFire);
  autoFireRef.current = autoFire;

  useEffect(() => {
    if (!autoFire || !scan?.symbols || !demoConnected) return;
    const candidates = scan.symbols.filter(s => s.isCandidate);
    candidates.forEach(s => {
      const key = `${s.symbol}-${s.positionSide}`;
      if (!firingSet.has(key)) {
        fireDemoOrder(s.symbol, s.positionSide as "LONG" | "SHORT", s.ev, s.ewmaWinRate, true);
      }
    });
  }, [scan?.scanTime, autoFire, demoConnected]);

  const scanSymbols = scan?.symbols ?? [];
  const candidates = scanSymbols.filter(s => s.isCandidate);

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <FlaskConical className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Demo Lab</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                VST account · sniper lógica completa · sem risco real
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* BTC Regime */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-mono ${
              btcRegime === "BULL" ? "border-green-500/30 bg-green-500/10 text-green-400"
              : btcRegime === "BEAR" ? "border-red-500/30 bg-red-500/10 text-red-400"
              : "border-border/40 text-muted-foreground"
            }`}>
              {btcRegime === "BULL" ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              <span className="font-bold">{btcRegime}</span>
              <span className="text-[10px] opacity-70">{btcChange >= 0 ? "+" : ""}{btcChange.toFixed(2)}%</span>
            </div>

            {/* Demo connection status */}
            {demoConnected ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                <span className="text-xs font-semibold text-blue-400">DEMO CONNECTED</span>
                <Button
                  variant="ghost" size="sm"
                  onClick={handleDisconnect}
                  className="h-6 w-6 p-0 ml-1 text-muted-foreground hover:text-red-400"
                >
                  <LogOut className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/40 bg-muted/10">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                <span className="text-xs text-muted-foreground">Demo offline</span>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr_320px] gap-5">
          {/* ── LEFT PANEL ── */}
          <div className="space-y-4">
            {/* Connect form */}
            {!demoConnected && (
              <Card className="bg-card/50 border-blue-500/20">
                <CardHeader className="px-4 pt-4 pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-blue-400" />
                    Ativar Modo Demo VST
                  </CardTitle>
                  <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                    Usa as mesmas credenciais da conexão principal, mas direciona as ordens para o servidor VST da BingX
                    (<span className="font-mono">open-api-vst.bingx.com</span>) — sem risco real.
                  </p>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-blue-500/8 border border-blue-500/20">
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      Certifique-se de que o <strong>Demo Trading</strong> está ativado no app BingX
                      (Futuros → Demo Trading) antes de conectar.
                    </p>
                  </div>
                  <Button
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white"
                    size="sm"
                    onClick={handleConnect}
                    disabled={connectMutation.isPending}
                  >
                    {connectMutation.isPending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
                      : <Radio className="w-3.5 h-3.5 mr-2" />
                    }
                    Ativar Demo VST
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Demo account balance */}
            {demoConnected && demoStatus && (
              <Card className="bg-card/50 border-blue-500/20">
                <CardHeader className="px-4 pt-4 pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-blue-400" />
                    Conta Demo ({demoStatus.currency ?? "VST"})
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Balance</span>
                    <span className="font-mono font-bold">
                      {parseFloat(demoStatus.balance ?? "0").toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Disponível</span>
                    <span className="font-mono">{parseFloat(demoStatus.availableBalance ?? "0").toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">PnL unrealizado</span>
                    <span className={`font-mono ${parseFloat(demoStatus.unrealizedPnl ?? "0") >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {parseFloat(demoStatus.unrealizedPnl ?? "0") >= 0 ? "+" : ""}{parseFloat(demoStatus.unrealizedPnl ?? "0").toFixed(4)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Posições abertas</span>
                    <span className="font-mono font-semibold">{demoStatus.openPositionsCount ?? 0}</span>
                  </div>
                  <Button
                    variant="ghost" size="sm"
                    className="w-full h-7 text-[10px] text-muted-foreground mt-1"
                    onClick={() => refetchStatus()}
                  >
                    <RefreshCw className="w-3 h-3 mr-1.5" /> Atualizar
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Bot config summary */}
            {config && (
              <Card className="bg-card/30 border-border/40">
                <CardHeader className="px-4 pt-4 pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Target className="w-4 h-4 text-primary" />
                    Parâmetros do Sniper
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2">
                  {[
                    ["Leverage", `${config.leverage}×`],
                    ["Margin / trade", `${config.marginPerTrade} USDT`],
                    ["Take profit", `${config.takeProfitPct}%`],
                    ["Stop loss", `${config.stopLossPct}%`],
                    ["EV mínimo", config.evMinThreshold > 0 ? `≥ ${config.evMinThreshold.toFixed(4)}` : "off"],
                    ["Win rate mín", config.winRateMin > 0 ? `≥ ${(config.winRateMin * 100).toFixed(0)}%` : "off"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono font-semibold">{value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Auto-fire control */}
            {demoConnected && (
              <Card className={`border-2 transition-colors ${autoFire ? "border-orange-500/50 bg-orange-500/5" : "border-border/40 bg-card/30"}`}>
                <CardContent className="px-4 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {autoFire
                        ? <Play className="w-4 h-4 text-orange-400" />
                        : <Square className="w-4 h-4 text-muted-foreground" />}
                      <span className={`text-sm font-bold ${autoFire ? "text-orange-400" : "text-muted-foreground"}`}>
                        Auto-Fire
                      </span>
                    </div>
                    <Switch checked={autoFire} onCheckedChange={setAutoFire} />
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {autoFire
                      ? "Disparando automaticamente em todos os candidatos a cada scan (8s). Monitore o log."
                      : "Quando ativado, dispara ordens demo nos candidatos que passam todos os gates."}
                  </p>
                  {autoFire && (
                    <div className="mt-3 flex items-center gap-2 text-[10px] text-orange-400 font-semibold">
                      <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
                      ESCANEANDO · {candidates.length} candidato{candidates.length !== 1 ? "s" : ""} ativo{candidates.length !== 1 ? "s" : ""}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {!demoConnected && (
              <div className="px-4 py-8 rounded-lg border border-dashed border-border/30 text-center">
                <FlaskConical className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-xs text-muted-foreground">Conecte a conta demo para habilitar o scanner e auto-fire</p>
              </div>
            )}
          </div>

          {/* ── CENTER PANEL — scanner ── */}
          <Card className="bg-card/40 border-border/40">
            <CardHeader className="px-4 pt-4 pb-3 border-b border-border/20">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Radio className="w-4 h-4 text-primary" />
                  Scanner Sniper
                  {scan && (
                    <span className={`ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      candidates.length > 0 ? "bg-green-500/15 text-green-400" : "bg-muted/30 text-muted-foreground"
                    }`}>
                      {candidates.length} ready
                    </span>
                  )}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {scan && (
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                      scan.btcRegime === "BULL" ? "bg-green-500/15 text-green-400"
                      : scan.btcRegime === "BEAR" ? "bg-red-500/15 text-red-400"
                      : "bg-muted/30 text-muted-foreground"
                    }`}>
                      {scan.btcRegime} · UTC{scan.currentHourUtc}h
                    </span>
                  )}
                </div>
              </div>
            </CardHeader>

            {!demoConnected ? (
              <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
                <Radio className="w-8 h-8 opacity-15" />
                <p className="text-sm">Scanner inativo — conecte a conta demo</p>
              </div>
            ) : (config?.allowedSymbols?.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
                <AlertTriangle className="w-8 h-8 opacity-20" />
                <p className="text-sm">Nenhum símbolo configurado</p>
                <p className="text-xs opacity-60">Configure SCALP_SYMBOLS no .env</p>
              </div>
            ) : !scan ? (
              <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin opacity-30" />
                <p className="text-sm">Escaneando...</p>
              </div>
            ) : scanSymbols.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                <p className="text-sm">Nenhum símbolo no scan</p>
              </div>
            ) : (
              <div className="overflow-y-auto max-h-[600px]">
                {scanSymbols.map((s, i) => {
                  const key = `${s.symbol}-${s.positionSide}`;
                  return (
                    <ScanRow
                      key={`${key}-${i}`}
                      {...s}
                      autoFire={autoFire}
                      firing={firingSet.has(key)}
                      onFire={() => fireDemoOrder(
                        s.symbol,
                        s.positionSide as "LONG" | "SHORT",
                        s.ev,
                        s.ewmaWinRate,
                        true,
                      )}
                    />
                  );
                })}
              </div>
            )}

            {/* Legend */}
            {scanSymbols.length > 0 && (
              <div className="px-4 py-2 border-t border-border/20 flex items-center gap-4 flex-wrap">
                {[
                  ["bg-green-400 animate-pulse", "ready"],
                  ["bg-red-500", "toxic"],
                  ["bg-yellow-400", "pass (no EV data)"],
                  ["bg-muted-foreground/40", "blocked"],
                ].map(([cls, label]) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${cls}`} />
                    <span className="text-[9px] text-muted-foreground">{label}</span>
                  </div>
                ))}
                <span className="text-[9px] text-muted-foreground ml-auto">scan a cada 8s</span>
              </div>
            )}
          </Card>

          {/* ── RIGHT PANEL — log ── */}
          <Card className="bg-card/30 border-border/40 flex flex-col">
            <CardHeader className="px-4 pt-4 pb-3 border-b border-border/20 shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  Execution Log
                </CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-muted-foreground">{log.length} entries</span>
                  {log.length > 0 && (
                    <Button
                      variant="ghost" size="sm"
                      className="h-6 px-2 text-[10px] text-muted-foreground"
                      onClick={() => setLog([])}
                    >
                      clear
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>

            <div ref={logRef} className="flex-1 overflow-y-auto max-h-[640px]">
              {log.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                  <ArrowRight className="w-6 h-6 opacity-15" />
                  <p className="text-xs">Nenhuma ordem ainda</p>
                  <p className="text-[10px] opacity-60">Use o botão "Fire" ou ative o Auto-Fire</p>
                </div>
              ) : (
                log.map(entry => <LogRow key={entry.id} entry={entry} />)
              )}
            </div>

            {/* Log summary */}
            {log.length > 0 && (
              <div className="px-4 py-3 border-t border-border/20 shrink-0">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-sm font-bold text-green-400">{log.filter(l => l.placed).length}</div>
                    <div className="text-[9px] text-muted-foreground">filled</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-red-400">{log.filter(l => !l.placed && !l.observationMode).length}</div>
                    <div className="text-[9px] text-muted-foreground">blocked</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-muted-foreground">{log.filter(l => l.observationMode).length}</div>
                    <div className="text-[9px] text-muted-foreground">obs</div>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* How it works */}
        <Card className="border-border/20 bg-card/10">
          <CardContent className="px-5 py-4">
            <div className="flex items-start gap-6 flex-wrap">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
                <span>Conecte sua <strong>API Key da conta Demo</strong> BingX (VST)</span>
              </div>
              <ArrowRight className="w-3 h-3 text-border/50 shrink-0 mt-1 hidden sm:block" />
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
                <span>Scanner roda a lógica sniper completa em todos os seus símbolos</span>
              </div>
              <ArrowRight className="w-3 h-3 text-border/50 shrink-0 mt-1 hidden sm:block" />
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
                <span><strong>Fire manual</strong> ou <strong>Auto-Fire</strong> dispara ordens reais na conta VST</span>
              </div>
              <ArrowRight className="w-3 h-3 text-border/50 shrink-0 mt-1 hidden sm:block" />
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">4</span>
                <span>Resultados alimentam o <strong>telemetry</strong> → calibra edge para conta real</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

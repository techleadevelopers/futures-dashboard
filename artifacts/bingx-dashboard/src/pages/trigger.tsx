import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api-url";
import {
  getTriggerStatus,
  getTriggerStatusQueryKey,
  useEnableTrigger,
  useDisableTrigger,
  useSnapshotTrigger,
  useResetTriggerSymbol,
  useNativeTriggerStatus,
  type TriggerSymbolState,
  type TriggerStatus,
  type NativeTriggerSymbol,
  type NativePendingOrder,
} from "@/api-client";
import {
  Target,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  AlertTriangle,
  Camera,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Clock,
  Zap,
  ArrowDown,
  ArrowUp,
  Activity,
  Settings,
  Eye,
  Grid3X3,
  Lock,
  Layers,
  DollarSign,
} from "lucide-react";


  // Mapeamento de ícones oficiais por símbolo (removendo -USDT)
const CRYPTO_ICONS: Record<string, string> = {
  BTC: "https://cryptologos.cc/logos/bitcoin-btc-logo.png",
  ETH: "https://cryptologos.cc/logos/ethereum-eth-logo.png",
  SOL: "https://cryptologos.cc/logos/solana-sol-logo.png",
  BNB: "https://cryptologos.cc/logos/bnb-bnb-logo.png",
  XRP: "https://cryptologos.cc/logos/xrp-xrp-logo.png",
  ADA: "https://cryptologos.cc/logos/cardano-ada-logo.png",
  AVAX: "https://cryptologos.cc/logos/avalanche-avax-logo.png",
  DOT: "https://cryptologos.cc/logos/polkadot-dot-logo.png",
  POL: "https://cryptologos.cc/logos/polygon-matic-logo.png",
  NEAR: "https://cryptologos.cc/logos/near-protocol-near-logo.png",
  ATOM: "https://cryptologos.cc/logos/cosmos-atom-logo.png",
  LINK: "https://cryptologos.cc/logos/chainlink-link-logo.png",
  UNI: "https://cryptologos.cc/logos/uniswap-uni-logo.png",
  ARB: "https://cryptologos.cc/logos/arbitrum-arb-logo.png",
  OP: "https://cryptologos.cc/logos/optimism-op-logo.png",
  DOGE: "https://cryptologos.cc/logos/dogecoin-doge-logo.png",
  VVV: "https://cryptologos.cc/logos/venus-xvs-logo.png",
  WIF: "https://cryptologos.cc/logos/wif-wif-logo.png",
  APT: "https://cryptologos.cc/logos/aptos-apt-logo.png",
  BEAT: "https://cryptologos.cc/logos/beat-beat-logo.png",
  SUI: "https://cryptologos.cc/logos/sui-sui-logo.png",
  WLD: "https://cryptologos.cc/logos/worldcoin-org-wld-logo.png",
  RENDER: "https://cryptologos.cc/logos/render-token-rndr-logo.png",
  FET: "https://cryptologos.cc/logos/fetch-ai-fet-logo.png",
  INJ: "https://cryptologos.cc/logos/injective-protocol-inj-logo.png",
  TAO: "https://cryptologos.cc/logos/bittensor-tao-logo.png",
  PEPE: "https://cryptologos.cc/logos/pepe-pepe-logo.png",
};

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—";
  return n.toFixed(decimals);
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 10000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "$0.00";
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;
}

function fmtAgo(ms: number | null): string {
  if (!ms) return "—";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s atrás`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m atrás`;
  return `${Math.floor(m / 60)}h atrás`;
}

function fmtTtl(ms: number): string {
  if (ms <= 0) return "expirado";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60 > 0 ? ` ${s % 60}s` : ""}`;
}

// ── Old trigger strategy components ──────────────────────────────────────────

type TriggerPnlReport = {
  live?: {
    totalTrades?: number;
    wins?: number;
    losses?: number;
    profitFactor?: number;
    netPnlUsdt?: number;
    grossWinUsdt?: number;
    grossLossUsdt?: number;
  };
};

function useTriggerPnlReport() {
  return useQuery<TriggerPnlReport>({
    queryKey: ["trigger-pnl-report"],
    queryFn: async () => {
      const r = await fetch(apiUrl("/api/sniper/pnl/report"), { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<TriggerPnlReport>;
    },
    refetchInterval: 15_000,
  });
}

function TriggerPnlMicroCard({
  report,
  pendingTotal = 0,
  pendingLong = 0,
  pendingShort = 0,
}: {
  report?: TriggerPnlReport;
  pendingTotal?: number;
  pendingLong?: number;
  pendingShort?: number;
}) {
  const live = report?.live;
  const wins = live?.wins ?? 0;
  const losses = live?.losses ?? 0;
  const totalTrades = live?.totalTrades ?? 0;
  const grossWin = live?.grossWinUsdt ?? 0;
  const grossLoss = live?.grossLossUsdt ?? 0;
  const net = live?.netPnlUsdt ?? 0;
  const pf = live?.profitFactor ?? 0;
  const netGood = net >= 0;

  return (
    <Card className="border-border/15 bg-card/8">
      <CardContent className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 min-w-[150px]">
            <div className={`w-7 h-7 rounded-md flex items-center justify-center ${netGood ? "bg-emerald-500/15" : "bg-rose-500/15"}`}>
              <DollarSign className={`w-3.5 h-3.5 ${netGood ? "text-emerald-400" : "text-rose-400"}`} />
            </div>
            <div>
              <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Resultado Trigger</div>
              <div className={`text-sm font-bold font-mono ${netGood ? "text-emerald-400" : "text-rose-400"}`}>
                {fmtUsd(net)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
            <div>
              <span className="text-muted-foreground/45">PnL + </span>
              <span className="font-mono font-semibold text-emerald-400">{fmtUsd(grossWin)}</span>
            </div>
            <div>
              <span className="text-muted-foreground/45">PnL - </span>
              <span className="font-mono font-semibold text-rose-400">-${grossLoss.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-muted-foreground/45">W/L </span>
              <span className="font-mono text-foreground/80">{wins}/{losses}</span>
            </div>
            <div>
              <span className="text-muted-foreground/45">PF </span>
              <span className={`font-mono font-semibold ${pf >= 1.2 ? "text-emerald-400" : pf >= 1 ? "text-amber-400" : "text-rose-400"}`}>
                {Number.isFinite(pf) ? fmt(pf, 2) : "∞"}
              </span>
            </div>
            <div className="h-3 w-px bg-border/25" />
            <div>
              <span className="text-muted-foreground/45">Pending </span>
              <span className="font-mono font-semibold text-foreground/80">{pendingTotal}</span>
            </div>
            <div>
              <span className="text-muted-foreground/45">LONG </span>
              <span className="font-mono font-semibold text-emerald-400">{pendingLong}</span>
            </div>
            <div>
              <span className="text-muted-foreground/45">SHORT </span>
              <span className="font-mono font-semibold text-rose-400">{pendingShort}</span>
            </div>
          </div>

          <Badge variant="outline" className="ml-auto text-[9px] border-border/30 text-muted-foreground/60">
            {totalTrades} trades
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function CompactTriggerCard({
  token,
  side,
  entryPrice,
  currentPrice,
  changePct,
  targetPrice,
}: {
  token: string;
  side: "LONG" | "SHORT";
  entryPrice: number | null | undefined;
  currentPrice: number | null | undefined;
  changePct: number;
  targetPrice: number | null | undefined;
}) {
  const isLong = side === "LONG";

  return (
    <div className={`relative h-20 w-full max-w-[300px] overflow-hidden rounded-[7px] border ${
      isLong
        ? "border-emerald-400/80 bg-emerald-950/25"
        : "border-rose-400/80 bg-rose-950/25"
    }`}>
      <div className={`absolute inset-x-0 top-0 h-px ${isLong ? "bg-emerald-300" : "bg-rose-300"}`} />
      <div className="grid h-full grid-cols-[68px_1fr_1fr_42px] grid-rows-[48px_20px] gap-x-1.5 px-2.5 pt-2">
        <div className="flex min-w-0 items-start gap-1.5">
          <img
            src={CRYPTO_ICONS[token] || CRYPTO_ICONS.BTC}
            alt={token}
            className="h-7 w-7 shrink-0 rounded-full object-contain"
            onError={(e) => (e.target as HTMLImageElement).src = CRYPTO_ICONS.BTC}
          />
          <span className="truncate pt-1 font-mono text-[11px] font-bold text-foreground">{token}</span>
        </div>

        <div className="min-w-0">
          <div className="truncate text-[6px] uppercase tracking-[0.12em] text-muted-foreground/60">
            Preço de entrada
          </div>
          <div className="mt-1 truncate font-mono text-[11px] font-bold leading-none text-foreground">
            {fmtPrice(entryPrice)}
          </div>
        </div>

        <div className="min-w-0">
          <div className="truncate text-[6px] uppercase tracking-[0.12em] text-muted-foreground/60">
            Preço atual
          </div>
          <div className="mt-1 truncate font-mono text-[11px] font-bold leading-none text-foreground">
            {fmtPrice(currentPrice)}
          </div>
          <div className={`mt-1 truncate font-mono text-[7px] font-semibold leading-none ${
            changePct >= 0 ? "text-emerald-400" : "text-rose-400"
          }`}>
            {changePct >= 0 ? "↘ " : "↗ "}{changePct >= 0 ? "+" : ""}{fmt(changePct)}% do ref
          </div>
        </div>

        <div className={`pt-1 text-right font-mono text-[9px] font-bold ${
          isLong ? "text-emerald-400" : "text-rose-400"
        }`}>
          {side}
        </div>

        <div className="col-span-4 flex min-w-0 items-center gap-1.5 border-t border-white/[0.03] text-[8px]">
          <span className="shrink-0 text-muted-foreground/60">TP alvo</span>
          <span className={`truncate font-mono font-semibold ${
            isLong ? "text-emerald-400" : "text-rose-400"
          }`}>
            {fmtPrice(targetPrice)}
          </span>
          <span className="truncate font-mono text-[7px] text-muted-foreground/50">
            ({changePct >= 0 ? "+" : ""}{fmt(changePct)}%)
          </span>
        </div>
      </div>
    </div>
  );
}

function LegacyArmedCard({ s, side }: {
  s: TriggerSymbolState;
  side: "LONG" | "SHORT";
}) {
  const isLong = side === "LONG";
  const triggerPrice = isLong ? s.longTriggerPrice : s.shortTriggerPrice;
  const tpPct = isLong ? s.longTpPct : s.shortTpPct;
  const deviationPct = isLong ? s.dropPct : s.risePct;
  const firedAt = isLong ? s.longFiredAt : s.shortFiredAt;
  const token = s.symbol.replace("-USDT", "");
  const isFired = !!firedAt;

  return (
    <div className={`relative w-full max-w-[300px] rounded-lg border overflow-hidden ${
      isFired
        ? isLong
          ? "border-emerald-400/40 bg-emerald-950/30"
          : "border-rose-400/40 bg-rose-950/30"
        : isLong
          ? "border-emerald-500/25 bg-emerald-950/20"
          : "border-rose-500/25 bg-rose-950/20"
    }`}>
      {isFired && (
        <div className={`absolute top-0 left-0 right-0 h-0.5 ${isLong ? "bg-emerald-400" : "bg-rose-400"}`} />
      )}

      <div className="p-3">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <img
              src={CRYPTO_ICONS[token] || CRYPTO_ICONS.BTC}
              alt={token}
              className="w-7 h-7 rounded-full object-contain shrink-0"
              onError={(e) => (e.target as HTMLImageElement).src = CRYPTO_ICONS.BTC}
            />
            <div>
              <div className="text-sm font-bold text-foreground font-mono">{token}</div>
              <div className={`text-[9px] font-semibold tracking-wider ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
                {side} {isFired ? "· DISPARADO" : "· ARMADO"}
              </div>
            </div>
          </div>
          <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
            isLong ? "bg-emerald-500/20" : "bg-rose-500/20"
          }`}>
            {isLong
              ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              : <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
            }
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="bg-black/20 rounded-md p-2">
            <div className="text-[8px] text-muted-foreground/60 uppercase tracking-wider mb-0.5">
              Preço de Entrada
            </div>
            <div className="text-sm font-bold font-mono text-foreground">
              {fmtPrice(triggerPrice)}
            </div>
            <div className="text-[9px] text-muted-foreground/50">USDT</div>
          </div>
          <div className="bg-black/20 rounded-md p-2">
            <div className="text-[8px] text-muted-foreground/60 uppercase tracking-wider mb-0.5">
              Preço Atual
            </div>
            <div className="text-sm font-bold font-mono text-foreground">
              {fmtPrice(s.currentPrice)}
            </div>
            <div className={`text-[9px] flex items-center gap-0.5 ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
              {isLong ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />}
              {isLong ? "−" : "+"}{fmt(deviationPct)}% do ref
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-[9px]">
            <span className="text-muted-foreground/60">Referência</span>
            <span className="font-mono text-foreground/80">{fmtPrice(s.referencePrice)}</span>
          </div>
          <div className="flex justify-between text-[9px]">
            <span className="text-muted-foreground/60">TP alvo</span>
            <span className={`font-mono font-semibold ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
              {fmtPrice(s.referencePrice)} (+{fmt(tpPct)}%)
            </span>
          </div>

        </div>

      </div>
    </div>
  );
}

function ArmedCard({ s, side, nativeSymbol }: {
  s: TriggerSymbolState;
  side: "LONG" | "SHORT";
  nativeSymbol?: NativeTriggerSymbol;
}) {
  const isLong = side === "LONG";
  const nativeEntry = (isLong ? nativeSymbol?.longGrid : nativeSymbol?.shortGrid)?.[0];
  const triggerPrice = nativeEntry?.triggerPrice ?? (isLong ? s.longTriggerPrice : s.shortTriggerPrice);
  const targetPrice = nativeEntry?.targetPrice
    ?? s.referencePrice * (1 + (isLong ? s.longTpPct : -s.shortTpPct) / 100);
  const deviationPct = nativeSymbol
    ? (isLong ? Math.abs(nativeSymbol.recentMovePct) : -Math.abs(nativeSymbol.recentMovePct))
    : (isLong ? Math.abs(s.dropPct) : -Math.abs(s.risePct));

  return (
    <CompactTriggerCard
      token={s.symbol.replace("-USDT", "")}
      side={side}
      entryPrice={triggerPrice}
      currentPrice={nativeSymbol?.currentPrice ?? s.currentPrice}
      changePct={deviationPct}
      targetPrice={targetPrice}
    />
  );
}

function SymbolRow({
  s,
  onReset,
  nativeLongPending = 0,
  nativeShortPending = 0,
}: {
  s: TriggerSymbolState;
  onReset: (sym: string) => void;
  nativeLongPending?: number;
  nativeShortPending?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const longPct = Math.min(100, (s.dropPct / (s.longTpPct || 1)) * 100);
  const shortPct = Math.min(100, (s.risePct / (s.shortTpPct || 1)) * 100);
  const token = s.symbol.replace("-USDT", "");
  const hasNativePending = nativeLongPending > 0 || nativeShortPending > 0;


  return (
    <div className="border border-border/15 rounded-lg bg-card/5 overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/8 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-1.5 w-20 shrink-0">
  <img
    src={CRYPTO_ICONS[token] || CRYPTO_ICONS.BTC}
    alt={token}
    className="w-4 h-4 rounded-full"
    onError={(e) => (e.target as HTMLImageElement).src = CRYPTO_ICONS.BTC}
  />
  <span className="font-mono text-xs font-semibold text-foreground/85">{token}</span>
</div>

        <div className="flex items-center gap-1.5 shrink-0 w-32">
          <span className={`text-[10px] font-mono tabular-nums ${s.dropPct >= 0.1 ? "text-emerald-400" : "text-muted-foreground/35"}`}>
            ▼{fmt(s.dropPct)}%
          </span>
          <span className="text-[9px] text-muted-foreground/25">/</span>
          <span className={`text-[10px] font-mono tabular-nums ${s.risePct >= 0.1 ? "text-rose-400" : "text-muted-foreground/35"}`}>
            ▲{fmt(s.risePct)}%
          </span>
        </div>

        <div className="flex-1 flex items-center gap-1.5">
          {s.longArmed && (
            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/25 text-[9px] px-1.5 py-0 h-4">
              <Zap className="w-2 h-2 mr-0.5" />LONG
            </Badge>
          )}
          {s.shortArmed && (
            <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/25 text-[9px] px-1.5 py-0 h-4">
              <Zap className="w-2 h-2 mr-0.5" />SHORT
            </Badge>
          )}
          {nativeLongPending > 0 && (
            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/25 text-[9px] px-1.5 py-0 h-4">
              <Zap className="w-2 h-2 mr-0.5" />{nativeLongPending} LONG
            </Badge>
          )}
          {nativeShortPending > 0 && (
            <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/25 text-[9px] px-1.5 py-0 h-4">
              <Zap className="w-2 h-2 mr-0.5" />{nativeShortPending} SHORT
            </Badge>
          )}
          {!s.longArmed && !s.shortArmed && !hasNativePending && (
            <span className="text-[9px] text-muted-foreground/35">monitorando</span>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-3 text-[9px] text-muted-foreground/45 shrink-0">
          <span>ref <span className="font-mono">{fmtPrice(s.referencePrice)}</span></span>
          <span>{s.secondsSinceSnapshot}s</span>
        </div>

        {expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground/30 shrink-0" /> : <ChevronDown className="w-3 h-3 text-muted-foreground/30 shrink-0" />}
      </div>

      {expanded && (
        <div className="border-t border-border/10 px-3 py-3 bg-black/10">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="space-y-1.5">
              <div className="text-[9px] font-semibold text-emerald-400/70 uppercase tracking-wider flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />LONG Gate
                {nativeLongPending > 0 && <span className="ml-1 text-[8px] text-emerald-300">ARMADO x{nativeLongPending}</span>}
              </div>
              <div className="space-y-0.5 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground/55">Entrada</span>
                  <span className="font-mono text-foreground/80">{fmtPrice(s.longTriggerPrice)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground/55">TP alvo</span>
                  <span className="font-mono text-emerald-400">{fmtPrice(s.referencePrice)} (+{fmt(s.longTpPct)}%)</span>
                </div>
              </div>
              <div className="h-1 bg-border/20 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500/60 transition-all duration-500" style={{ width: `${Math.max(0, longPct)}%` }} />
              </div>
              {s.longFiredAt && (
                <div className="text-[9px] text-emerald-400/50 flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />Disparado {fmtAgo(s.longFiredAt)}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="text-[9px] font-semibold text-rose-400/70 uppercase tracking-wider flex items-center gap-1">
                <TrendingDown className="w-3 h-3" />SHORT Gate
                {nativeShortPending > 0 && <span className="ml-1 text-[8px] text-rose-300">ARMADO x{nativeShortPending}</span>}
              </div>
              <div className="space-y-0.5 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground/55">Entrada</span>
                  <span className="font-mono text-foreground/80">{fmtPrice(s.shortTriggerPrice)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground/55">TP alvo</span>
                  <span className="font-mono text-rose-400">{fmtPrice(s.referencePrice)} (+{fmt(s.shortTpPct)}%)</span>
                </div>
              </div>
              <div className="h-1 bg-border/20 rounded-full overflow-hidden">
                <div className="h-full bg-rose-500/60 transition-all duration-500" style={{ width: `${Math.max(0, shortPct)}%` }} />
              </div>
              {s.shortFiredAt && (
                <div className="text-[9px] text-rose-400/50 flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />Disparado {fmtAgo(s.shortFiredAt)}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border/10">
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-muted-foreground/50">Atual</span>
              <span className="font-mono text-foreground/75">{fmtPrice(s.currentPrice)}</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-2 text-[9px] text-muted-foreground/45 hover:text-foreground/70"
              onClick={(e) => { e.stopPropagation(); onReset(s.symbol); }}
            >
              <RotateCcw className="w-2.5 h-2.5 mr-1" />Reset ref
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tail Hunter Native Grid components ────────────────────────────────────────

function PendingOrderRow({ o }: { o: NativePendingOrder }) {
  const isLong = o.direction === "LONG";
  const token = o.symbol.replace("-USDT", "");
  const ttlPct = Math.min(100, (o.ttlRemainingMs / (o.expiresAt - o.armedAt)) * 100);

  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${
      isLong
        ? "border-emerald-500/20 bg-emerald-950/15"
        : "border-rose-500/20 bg-rose-950/15"
    }`}>
      <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${
        isLong ? "bg-emerald-500/20" : "bg-rose-500/20"
      }`}>
        {isLong
          ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          : <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
        }
      </div>
      <div className="flex items-center gap-1.5 w-20 shrink-0">
  <img
    src={CRYPTO_ICONS[token] || CRYPTO_ICONS.BTC}
    alt={token}
    className="w-4 h-4 rounded-full"
    onError={(e) => (e.target as HTMLImageElement).src = CRYPTO_ICONS.BTC}
  />
  <span className="font-mono text-xs font-bold text-foreground/85">{token}</span>
</div>
      <div className={`text-[10px] font-semibold shrink-0 ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
        {o.direction}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-mono text-foreground/75">{fmtPrice(o.triggerPrice)}</div>
        {o.sectorCluster && (
          <div className="text-[9px] text-muted-foreground/40 truncate">{o.sectorCluster}</div>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className={`text-[9px] font-mono ${o.ttlRemainingMs < 30000 ? "text-amber-400" : "text-muted-foreground/50"}`}>
          {fmtTtl(o.ttlRemainingMs)}
        </div>
        <div className="w-16 h-0.5 bg-black/30 rounded-full mt-1 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${
              ttlPct < 20 ? "bg-amber-400" : isLong ? "bg-emerald-500/70" : "bg-rose-500/70"
            }`}
            style={{ width: `${Math.max(0, ttlPct)}%` }}
          />
        </div>
      </div>
      <div className="text-[9px] text-muted-foreground/35 shrink-0">{fmtAgo(o.armedAt)}</div>
    </div>
  );
}

function NativeSymbolCard({ sym }: { sym: NativeTriggerSymbol }) {
  const [expanded, setExpanded] = useState(false);
  const token = sym.symbol.replace("-USDT", "");
  const movePct = sym.recentMovePct;
  const displayPct = sym.priceChangePct ?? movePct;
  const isDropping = displayPct < 0;
  const isPumping = displayPct > 0;
  const inCooldownLong = sym.longCooldownMs > 0;
  const inCooldownShort = sym.shortCooldownMs > 0;

  const absMov = Math.abs(movePct);

  return (
    <div className="border border-border/15 rounded-lg bg-card/5 overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/8 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-1.5 w-24 shrink-0">
          <img
            src={CRYPTO_ICONS[token] || CRYPTO_ICONS.BTC}
            alt={token}
            className="w-4 h-4 rounded-full"
            onError={(e) => (e.target as HTMLImageElement).src = CRYPTO_ICONS.BTC}
          />
          <span className="font-mono text-xs font-semibold text-foreground/85">{sym.symbol}</span>
        </div>

        <div className={`flex items-center gap-0.5 shrink-0 w-20 text-[10px] font-mono tabular-nums ${
          isPumping ? "text-emerald-400" : isDropping ? "text-rose-400" : "text-muted-foreground/40"
        }`}>
          {isDropping ? <ArrowDown className="w-2.5 h-2.5" /> : isPumping ? <ArrowUp className="w-2.5 h-2.5" /> : null}
          {displayPct >= 0 ? "+" : ""}{fmt(displayPct)}%
        </div>

        <div className="flex-1 flex items-center gap-1.5">
          {sym.wouldFireLong && (
            <Badge className="bg-emerald-400/20 text-emerald-300 border-emerald-400/30 text-[9px] px-1.5 py-0 h-4">
              <Zap className="w-2 h-2 mr-0.5" />LONG
            </Badge>
          )}
          {sym.wouldFireShort && (
            <Badge className="bg-rose-400/20 text-rose-300 border-rose-400/30 text-[9px] px-1.5 py-0 h-4">
              <Zap className="w-2 h-2 mr-0.5" />SHORT
            </Badge>
          )}
          {inCooldownLong && (
            <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/25 text-[9px] px-1.5 py-0 h-4">
              <Clock className="w-2 h-2 mr-0.5" />CD-L {fmtTtl(sym.longCooldownMs)}
            </Badge>
          )}
          {inCooldownShort && (
            <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/25 text-[9px] px-1.5 py-0 h-4">
              <Clock className="w-2 h-2 mr-0.5" />CD-S {fmtTtl(sym.shortCooldownMs)}
            </Badge>
          )}
          {!sym.wouldFireLong && !sym.wouldFireShort && !inCooldownLong && !inCooldownShort && (
            <span className="text-[9px] text-muted-foreground/30">aguardando</span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[9px] text-muted-foreground/40 font-mono">{fmtPrice(sym.currentPrice)}</span>
        </div>

        {expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground/30 shrink-0" /> : <ChevronDown className="w-3 h-3 text-muted-foreground/30 shrink-0" />}
      </div>

      {expanded && (
        <div className="border-t border-border/10 px-3 py-3 bg-black/10 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {/* LONG grid levels */}
            <div className="space-y-1.5">
              <div className="text-[9px] font-semibold text-emerald-400/70 uppercase tracking-wider flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />LONG Grid ({sym.longGrid.length} níveis)
              </div>
              {sym.longGrid.length === 0 ? (
                <div className="text-[9px] text-muted-foreground/35">sem dados de candle</div>
              ) : (
                <div className="space-y-1">
                  {sym.longGrid.map((lvl) => {
                    const pct = Math.min(100, Math.max(0, (absMov / lvl.distancePct) * 100));
                    return (
                      <div key={lvl.level} className="bg-black/20 rounded p-1.5 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-emerald-400/60 font-semibold">L{lvl.level} · −{fmt(lvl.distancePct)}% · {Math.round(lvl.allocationFactor * 100)}%</span>
                          <span className="text-[9px] font-mono text-foreground/70">{fmtPrice(lvl.triggerPrice)}</span>
                        </div>
                        <div className="h-0.5 bg-border/20 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500/50 transition-all duration-500" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="flex justify-between text-[9px]">
                          <span className="text-muted-foreground/40">TP <span className="font-mono text-emerald-400/70">{fmtPrice(lvl.targetPrice)}</span></span>
                          <span className="text-muted-foreground/40">SL <span className="font-mono text-rose-400/70">{fmtPrice(lvl.stopPrice)}</span></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* SHORT grid levels */}
            <div className="space-y-1.5">
              <div className="text-[9px] font-semibold text-rose-400/70 uppercase tracking-wider flex items-center gap-1">
                <TrendingDown className="w-3 h-3" />SHORT Grid ({sym.shortGrid.length} níveis)
              </div>
              {sym.shortGrid.length === 0 ? (
                <div className="text-[9px] text-muted-foreground/35">sem dados de candle</div>
              ) : (
                <div className="space-y-1">
                  {sym.shortGrid.map((lvl) => {
                    const pct = Math.min(100, Math.max(0, (absMov / lvl.distancePct) * 100));
                    return (
                      <div key={lvl.level} className="bg-black/20 rounded p-1.5 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-rose-400/60 font-semibold">S{lvl.level} · +{fmt(lvl.distancePct)}% · {Math.round(lvl.allocationFactor * 100)}%</span>
                          <span className="text-[9px] font-mono text-foreground/70">{fmtPrice(lvl.triggerPrice)}</span>
                        </div>
                        <div className="h-0.5 bg-border/20 rounded-full overflow-hidden">
                          <div className="h-full bg-rose-500/50 transition-all duration-500" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="flex justify-between text-[9px]">
                          <span className="text-muted-foreground/40">TP <span className="font-mono text-emerald-400/70">{fmtPrice(lvl.targetPrice)}</span></span>
                          <span className="text-muted-foreground/40">SL <span className="font-mono text-rose-400/70">{fmtPrice(lvl.stopPrice)}</span></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="pt-1.5 border-t border-border/10 flex items-center gap-4 text-[9px] text-muted-foreground/40">
            <span>Atual <span className="font-mono text-foreground/60">{fmtPrice(sym.currentPrice)}</span></span>
            <span>24h <span className={`font-mono ${displayPct > 0 ? "text-emerald-400/60" : displayPct < 0 ? "text-rose-400/60" : ""}`}>{displayPct >= 0 ? "+" : ""}{fmt(displayPct)}%</span></span>
            <span>ATR <span className="font-mono">{fmt(sym.atrPct)}%</span></span>
            <span>Mov 5m <span className={`font-mono ${movePct < 0 ? "text-emerald-400/60" : movePct > 0 ? "text-rose-400/60" : ""}`}>{movePct >= 0 ? "+" : ""}{fmt(movePct)}%</span></span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function LegacyNativeFireCard({ sym, side }: { sym: NativeTriggerSymbol; side: "LONG" | "SHORT" }) {
  const isLong = side === "LONG";
  const token = sym.symbol.replace("-USDT", "");
  const grid = isLong ? sym.longGrid : sym.shortGrid;
  const entry = grid[0];
  const movePct = sym.recentMovePct;

  return (
    <div className={`relative w-full max-w-[300px] rounded-lg border overflow-hidden ${
      isLong ? "border-emerald-400/40 bg-emerald-950/30" : "border-rose-400/40 bg-rose-950/30"
    }`}>
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${isLong ? "bg-emerald-400" : "bg-rose-400"}`} />

      <div className="p-3">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-md flex items-center justify-center ${isLong ? "bg-emerald-500/20" : "bg-rose-500/20"}`}>
              <img
                src={CRYPTO_ICONS[token] || CRYPTO_ICONS.BTC}
                alt={token}
                className="w-4 h-4 rounded-full"
                onError={(e) => (e.target as HTMLImageElement).src = CRYPTO_ICONS.BTC}
              />
            </div>
            <div>
              <div className="text-sm font-bold text-foreground font-mono">{token}</div>
              <div className={`text-[9px] font-semibold tracking-wider ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
                {side} · ARMED
              </div>
            </div>
          </div>
          <Badge className={`text-[9px] px-1.5 py-0 ${
            isLong
              ? "bg-emerald-400/20 text-emerald-300 border-emerald-400/30"
              : "bg-rose-400/20 text-rose-300 border-rose-400/30"
          }`}>
            <Zap className="w-2.5 h-2.5 mr-0.5" />{side} FIRE
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="bg-black/20 rounded-md p-2">
            <div className="text-[8px] text-muted-foreground/60 uppercase tracking-wider mb-0.5">
              Preço de Entrada
            </div>
            <div className="text-sm font-bold font-mono text-foreground">
              {fmtPrice(entry?.triggerPrice ?? sym.currentPrice)}
            </div>
            <div className="text-[9px] text-muted-foreground/50">USDT</div>
          </div>
          <div className="bg-black/20 rounded-md p-2">
            <div className="text-[8px] text-muted-foreground/60 uppercase tracking-wider mb-0.5">
              Preço Atual
            </div>
            <div className="text-sm font-bold font-mono text-foreground">
              {fmtPrice(sym.currentPrice)}
            </div>
            <div className={`text-[9px] font-semibold ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
              {movePct >= 0 ? "+" : ""}{fmt(movePct)}% agora
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-[9px]">
            <span className="text-muted-foreground/50">Referência</span>
            <span className="font-mono text-foreground/80">{fmtPrice(sym.currentPrice)}</span>
          </div>
          <div className="flex justify-between text-[9px]">
            <span className="text-muted-foreground/50">TP alvo</span>
            <span className={`font-mono font-semibold ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
              {fmtPrice(entry?.targetPrice)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function NativeFireCard({ sym, side }: { sym: NativeTriggerSymbol; side: "LONG" | "SHORT" }) {
  const isLong = side === "LONG";
  const grid = isLong ? sym.longGrid : sym.shortGrid;
  const entry = grid[0];
  const movePct = isLong ? Math.abs(sym.recentMovePct) : -Math.abs(sym.recentMovePct);

  return (
    <CompactTriggerCard
      token={sym.symbol.replace("-USDT", "")}
      side={side}
      entryPrice={entry?.triggerPrice ?? sym.currentPrice}
      currentPrice={sym.currentPrice}
      changePct={movePct}
      targetPrice={entry?.targetPrice}
    />
  );
}

export default function TriggerPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [longDropPct, setLongDropPct] = useState("1.74");
  const [shortRisePct, setShortRisePct] = useState("3.16");
  const [slPct, setSlPct] = useState("0.55");
  const [cooldownMin, setCooldownMin] = useState("5");
  const [showConfig, setShowConfig] = useState(false);

  const { data: status, isLoading, refetch } = useQuery<TriggerStatus>({
    queryKey: getTriggerStatusQueryKey(),
    queryFn: getTriggerStatus,
    refetchInterval: 3000,
  });

  const { data: nativeStatus, isLoading: nativeLoading, refetch: nativeRefetch } = useNativeTriggerStatus();
  const { data: pnlReport } = useTriggerPnlReport();

  const enableMut = useEnableTrigger({
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getTriggerStatusQueryKey() });
      toast({ title: "Gatilho ativado", description: "Referências capturadas para todos os símbolos." });
    },
    onError: (e) => toast({ title: "Erro", description: String(e), variant: "destructive" }),
  });

  const disableMut = useDisableTrigger({
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getTriggerStatusQueryKey() });
      toast({ title: "Gatilho desativado" });
    },
  });

  const snapshotMut = useSnapshotTrigger({
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: getTriggerStatusQueryKey() });
      toast({ title: "Referências re-capturadas", description: `${r.snapshotted} símbolo(s) atualizados.` });
    },
    onError: (e) => toast({ title: "Erro", description: String(e), variant: "destructive" }),
  });

  const resetMut = useResetTriggerSymbol({
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: getTriggerStatusQueryKey() });
      toast({ title: "Estado resetado", description: `${r.reset}` });
    },
  });

  const handleToggle = useCallback((checked: boolean) => {
    if (checked) {
      enableMut.mutate({
        longDropPct: parseFloat(longDropPct) || 1.74,
        shortRisePct: parseFloat(shortRisePct) || 3.16,
        slPct: parseFloat(slPct) || 0.55,
        cooldownMs: (parseFloat(cooldownMin) || 5) * 60 * 1000,
      });
    } else {
      disableMut.mutate();
    }
  }, [longDropPct, shortRisePct, slPct, cooldownMin, enableMut, disableMut]);

  const isEnabled = status?.enabled ?? false;
  const isPending = enableMut.isPending || disableMut.isPending;

  const armedSymbols = (status?.symbols ?? []).filter(s => s.longArmed || s.shortArmed || s.longFiredAt || s.shortFiredAt);
  const monitoringSymbols = (status?.symbols ?? []).filter(s => !s.longArmed && !s.shortArmed && !s.longFiredAt && !s.shortFiredAt);

  const armedCards: Array<{ s: TriggerSymbolState; side: "LONG" | "SHORT" }> = [];
  for (const s of (status?.symbols ?? [])) {
    if (s.longArmed || s.longFiredAt) armedCards.push({ s, side: "LONG" });
    if (s.shortArmed || s.shortFiredAt) armedCards.push({ s, side: "SHORT" });
  }

  const nativeSymbols = nativeStatus?.symbols ?? [];
  const nativeSymbolsByName = new Map(nativeSymbols.map((symbol) => [symbol.symbol, symbol]));
  const nativeSymbolsFireable = nativeSymbols.filter(s => s.wouldFireLong || s.wouldFireShort);
  const muxLocked = nativeStatus?.muxLock?.locked ?? false;
  const nativePendingBySymbol = new Map<string, { long: number; short: number }>();
  for (const order of nativeStatus?.pendingOrders ?? []) {
    const current = nativePendingBySymbol.get(order.symbol) ?? { long: 0, short: 0 };
    if (order.direction === "LONG") current.long++;
    else current.short++;
    nativePendingBySymbol.set(order.symbol, current);
  }
  const totalLongArmed = (status?.armedLong ?? 0) + (nativeStatus?.pendingLong ?? 0);
  const totalShortArmed = (status?.armedShort ?? 0) + (nativeStatus?.pendingShort ?? 0);
  const totalActiveTriggers = armedCards.length + (nativeStatus?.pendingOrders.length ?? 0);

  return (
    <AppShell>
      <div className="p-4 md:p-6 space-y-4 max-w-[1720px] mx-auto">

        {/* ── Header ── */}
        <div className="hidden">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isEnabled ? "bg-emerald-500/20" : "bg-muted/15"}`}>
              <Target className={`w-4 h-4 ${isEnabled ? "text-emerald-400" : "text-muted-foreground/50"}`} />
            </div>
            <div>
              <h1 className="text-base font-bold text-foreground flex items-center gap-2">
                Estratégia Gatilho
                {isEnabled && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-normal bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 rounded-full px-2 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    ATIVO · {status?.symbolCount ?? 0} símbolos
                  </span>
                )}
              </h1>
              <p className="text-[10px] text-muted-foreground/55">
                Dispara entrada por desvio de preço do ponto de referência
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() => { refetch(); nativeRefetch(); }}
              disabled={isLoading || nativeLoading}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${(isLoading || nativeLoading) ? "animate-spin" : ""}`} />
            </Button>
            {isEnabled && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px] border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                onClick={() => snapshotMut.mutate()}
                disabled={snapshotMut.isPending}
              >
                <Camera className="w-3.5 h-3.5 mr-1" />
                {snapshotMut.isPending ? "Capturando..." : "Re-snapshot"}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className={`h-7 px-2 text-[11px] ${showConfig ? "bg-muted/20" : ""}`}
              onClick={() => setShowConfig(v => !v)}
            >
              <Settings className="w-3.5 h-3.5 mr-1" />Config
            </Button>
          </div>
        </div>

        {/* ── Config (collapsible) ── */}
        {false && showConfig && (
          <Card className="border-border/20 bg-card/8">
            <CardContent className="px-4 py-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
                <div>
                  <label className="block text-[9px] text-muted-foreground/60 mb-1 uppercase tracking-wider">
                    <TrendingUp className="w-2.5 h-2.5 inline mr-0.5 text-emerald-400" />
                    LONG drop %
                  </label>
                  <input type="number" step="0.1" min="0.1" max="20"
                    className="w-full h-7 px-2 text-xs bg-background/50 border border-border/30 rounded text-foreground focus:outline-none focus:border-primary/50"
                    value={longDropPct} onChange={(e) => setLongDropPct(e.target.value)} disabled={isEnabled} />
                </div>
                <div>
                  <label className="block text-[9px] text-muted-foreground/60 mb-1 uppercase tracking-wider">
                    <TrendingDown className="w-2.5 h-2.5 inline mr-0.5 text-rose-400" />
                    SHORT rise %
                  </label>
                  <input type="number" step="0.1" min="0.1" max="20"
                    className="w-full h-7 px-2 text-xs bg-background/50 border border-border/30 rounded text-foreground focus:outline-none focus:border-primary/50"
                    value={shortRisePct} onChange={(e) => setShortRisePct(e.target.value)} disabled={isEnabled} />
                </div>
                <div>
                  <label className="block text-[9px] text-muted-foreground/60 mb-1 uppercase tracking-wider">Stop Loss %</label>
                  <input type="number" step="0.05" min="0.1" max="10"
                    className="w-full h-7 px-2 text-xs bg-background/50 border border-border/30 rounded text-foreground focus:outline-none focus:border-primary/50"
                    value={slPct} onChange={(e) => setSlPct(e.target.value)} disabled={isEnabled} />
                </div>
                <div>
                  <label className="block text-[9px] text-muted-foreground/60 mb-1 uppercase tracking-wider">Cooldown (min)</label>
                  <input type="number" step="1" min="1" max="60"
                    className="w-full h-7 px-2 text-xs bg-background/50 border border-border/30 rounded text-foreground focus:outline-none focus:border-primary/50"
                    value={cooldownMin} onChange={(e) => setCooldownMin(e.target.value)} disabled={isEnabled} />
                </div>
                <div className="flex flex-col items-center justify-end gap-1.5">
                  <Switch checked={isEnabled} onCheckedChange={handleToggle} disabled={isPending} />
                  <span className={`text-[9px] ${isEnabled ? "text-emerald-400" : "text-muted-foreground/50"}`}>
                    {isEnabled ? "Ativo" : "Inativo"}
                  </span>
                </div>
              </div>
              {isEnabled && (
                <div className="mt-3 text-[10px] text-amber-400/70 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" />Desative para alterar parâmetros.
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Inactive state ── */}
        {false && !isEnabled && (
          <Card className="border-border/20 bg-card/5">
            <CardContent className="flex flex-col items-center justify-center py-14 gap-4">
              <div className="w-14 h-14 rounded-full bg-muted/15 flex items-center justify-center">
                <Target className="w-7 h-7 text-muted-foreground/30" />
              </div>
              <div className="text-center">
                <div className="text-sm font-semibold text-muted-foreground/60">Gatilho inativo</div>
                <div className="text-[11px] text-muted-foreground/40 mt-1">
                  Clique em <strong>Config</strong> e ative o switch para iniciar o monitoramento
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={false} onCheckedChange={handleToggle} disabled={isPending} />
                <span className="text-[11px] text-muted-foreground/50">Ativar</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Active: gatilhos armados / disparados ── */}
        <div>
          <section className="hidden">
        {isEnabled && (
          <>
            {/* Status bar */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <Card className="border-border/15 bg-card/8">
                <CardContent className="px-3 py-2.5 text-center">
                  <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Monitorando</div>
                  <div className="text-xl font-bold text-foreground mt-0.5">{status?.symbolCount ?? 0}</div>
                  <div className="text-[9px] text-muted-foreground/40">símbolos</div>
                </CardContent>
              </Card>
              <Card className="border-emerald-500/20 bg-emerald-950/15">
                <CardContent className="px-3 py-2.5 text-center">
                  <div className="text-[9px] text-emerald-400/60 uppercase tracking-wider">LONG armado</div>
                  <div className="text-xl font-bold text-emerald-400 mt-0.5">{totalLongArmed}</div>
                  <div className="text-[9px] text-emerald-400/40">gatilhos</div>
                </CardContent>
              </Card>
              <Card className="border-rose-500/20 bg-rose-950/15">
                <CardContent className="px-3 py-2.5 text-center">
                  <div className="text-[9px] text-rose-400/60 uppercase tracking-wider">SHORT armado</div>
                  <div className="text-xl font-bold text-rose-400 mt-0.5">{totalShortArmed}</div>
                  <div className="text-[9px] text-rose-400/40">gatilhos</div>
                </CardContent>
              </Card>
              <Card className="border-border/15 bg-card/8">
                <CardContent className="px-3 py-2.5 text-center">
                  <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Queda / Alta</div>
                  <div className="text-sm font-bold text-foreground mt-0.5 tabular-nums">
                    <span className="text-emerald-400">{longDropPct}%</span>
                    <span className="text-muted-foreground/30 mx-1">/</span>
                    <span className="text-rose-400">{shortRisePct}%</span>
                  </div>
                  <div className="text-[9px] text-muted-foreground/40">disparo</div>
                </CardContent>
              </Card>
            </div>

            {/* Gatilhos armados / disparados */}
            {totalActiveTriggers > 0 ? (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <h2 className="text-sm font-semibold text-foreground">Gatilhos Ativos</h2>
                  <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400">
                    {totalActiveTriggers}
                  </Badge>
                  <div className="flex-1 h-px bg-border/15" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {armedCards.map(({ s, side }) => (
                    <ArmedCard
                      key={`${s.symbol}-${side}`}
                      s={s}
                      side={side}
                      nativeSymbol={nativeSymbolsByName.get(s.symbol)}
                    />
                  ))}
                  {armedCards.length === 0 && (nativeStatus?.pendingOrders ?? []).slice(0, 12).map((o) => (
                    <PendingOrderRow key={o.id} o={o} />
                  ))}
                </div>
              </div>
            ) : (
              <Card className="border-border/15 bg-card/5">
                <CardContent className="flex items-center justify-center py-8 gap-3">
                  <Eye className="w-5 h-5 text-muted-foreground/25" />
                  <div className="text-[12px] text-muted-foreground/45">
                    Nenhum gatilho armado — monitorando desvios de preço...
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Monitor por símbolo */}
            {status && status.symbols.length > 0 && (
              <Card className="border-border/15 bg-card/8">
                <CardHeader className="pb-2 pt-3.5 px-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-semibold flex items-center gap-2 text-muted-foreground/70">
                      <Activity className="w-3.5 h-3.5" />
                      Monitor por símbolo
                      <Badge variant="outline" className="text-[9px]">{status.symbols.length}</Badge>
                    </CardTitle>
                    <div className="flex items-center gap-3 text-[9px] text-muted-foreground/40">
                      <span>LONG drop {longDropPct}%</span>
                      <span>SHORT rise {shortRisePct}%</span>
                      <span>SL {slPct}%</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-1">
                  {armedSymbols.map((s) => (
                    <SymbolRow
                      key={s.symbol}
                      s={s}
                      onReset={(sym) => resetMut.mutate(sym)}
                      nativeLongPending={nativePendingBySymbol.get(s.symbol)?.long ?? 0}
                      nativeShortPending={nativePendingBySymbol.get(s.symbol)?.short ?? 0}
                    />
                  ))}
                  {armedSymbols.length > 0 && monitoringSymbols.length > 0 && (
                    <div className="flex items-center gap-2 py-1">
                      <div className="flex-1 h-px bg-border/10" />
                      <span className="text-[9px] text-muted-foreground/30">aguardando desvio</span>
                      <div className="flex-1 h-px bg-border/10" />
                    </div>
                  )}
                  {monitoringSymbols.map((s) => (
                    <SymbolRow
                      key={s.symbol}
                      s={s}
                      onReset={(sym) => resetMut.mutate(sym)}
                      nativeLongPending={nativePendingBySymbol.get(s.symbol)?.long ?? 0}
                      nativeShortPending={nativePendingBySymbol.get(s.symbol)?.short ?? 0}
                    />
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            Tail Hunter Grid — Motor Nativo de Gatilhos (sempre visível)
        ════════════════════════════════════════════════════════════════════ */}
          </section>

        <section className="min-w-0">
          <div className="flex items-center gap-2 mb-3">
            <Grid3X3 className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-semibold text-foreground">Trigger Edge</h2>
            <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-400">
              Motor Nativo
            </Badge>
            {nativeStatus?.config.brutalMode && (
              <Badge className="text-[9px] bg-rose-500/20 text-rose-300 border-rose-500/30">
                <Zap className="w-2 h-2 mr-0.5" />EDGE · {nativeStatus.config.totalLevels} níveis/símbolo
              </Badge>
            )}
            {nativeStatus?.config && !nativeStatus.config.brutalMode && (
              <Badge variant="outline" className="text-[9px] text-muted-foreground/50">
                {nativeStatus.config.totalLevels} níveis/símbolo
              </Badge>
            )}
            {muxLocked && (
              <Badge className="text-[9px] bg-amber-500/15 text-amber-400 border-amber-500/25">
                <Lock className="w-2 h-2 mr-0.5" />MUX LOCK
              </Badge>
            )}
            <div className="flex-1 h-px bg-border/15" />
            {nativeStatus?.config && (
              <span className="text-[9px] text-muted-foreground/40 shrink-0">
                inicial {nativeStatus.config.initialLevelsPerSide}x L -{fmt(nativeStatus.config.initialLongPct)}% · {nativeStatus.config.initialLevelsPerSide}x S +{fmt(nativeStatus.config.initialShortPct)}%
              </span>
            )}
          </div>

          <div className="mb-3">
            <TriggerPnlMicroCard
              report={pnlReport}
              pendingTotal={nativeStatus?.pendingOrders.length ?? 0}
              pendingLong={nativeStatus?.pendingLong ?? 0}
              pendingShort={nativeStatus?.pendingShort ?? 0}
            />
          </div>

          {isEnabled && armedCards.length > 0 && (
            <section className="mb-4">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-semibold text-foreground">Gatilhos Ativos</h2>
                <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400">
                  {armedCards.length}
                </Badge>
                <div className="flex-1 h-px bg-border/15" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(260px,300px))] justify-start gap-2">
                {armedCards.map(({ s, side }) => (
                  <ArmedCard
                    key={`${s.symbol}-${side}`}
                    s={s}
                    side={side}
                    nativeSymbol={nativeSymbolsByName.get(s.symbol)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Pending orders list */}
          {(nativeStatus?.pendingOrders.length ?? 0) > 0 ? (
            <Card className="border-border/15 bg-card/8 mb-3">
              <CardHeader className="pb-2 pt-3.5 px-4">
                <CardTitle className="text-xs font-semibold flex items-center gap-2 text-muted-foreground/70">
                  <Layers className="w-3.5 h-3.5 text-violet-400" />
                  Ordens LIMIT no BingX
                  <Badge variant="outline" className="text-[9px] border-violet-500/30 text-violet-400">
                    {nativeStatus!.pendingOrders.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 space-y-1.5 max-h-72 overflow-y-auto pr-2">
                {nativeStatus!.pendingOrders.map((o) => (
                  <PendingOrderRow key={o.id} o={o} />
                ))}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border/15 bg-card/5 mb-3">
              <CardContent className="flex items-center justify-center py-6 gap-3">
                <Eye className="w-4 h-4 text-muted-foreground/25" />
                <div className="text-[11px] text-muted-foreground/40">
                  Nenhuma ordem LIMIT pendente no BingX
                </div>
              </CardContent>
            </Card>
          )}

          {/* Symbols with wouldFire first */}
          {nativeSymbolsFireable.length > 0 && (
            <div className="mb-2">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] font-semibold text-amber-400">Prontos para disparar</span>
                <Badge className="text-[9px] bg-amber-500/15 text-amber-400 border-amber-500/25">{nativeSymbolsFireable.length}</Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(260px,300px))] justify-start gap-2">
                {nativeSymbolsFireable.flatMap((sym) => {
                  const cards = [];
                  if (sym.wouldFireLong) {
                    cards.push(<NativeFireCard key={`${sym.symbol}-LONG`} sym={sym} side="LONG" />);
                  }
                  if (sym.wouldFireShort) {
                    cards.push(<NativeFireCard key={`${sym.symbol}-SHORT`} sym={sym} side="SHORT" />);
                  }
                  return cards;
                })}
              </div>
            </div>
          )}

          {/* All symbols grid */}
          <Card className="border-border/15 bg-card/8">
            <CardHeader className="pb-2 pt-3.5 px-4">
              <CardTitle className="text-xs font-semibold flex items-center gap-2 text-muted-foreground/70">
                <Activity className="w-3.5 h-3.5" />
                Trigger Sniper
                <Badge variant="outline" className="text-[9px]">{nativeSymbols.length}</Badge>
                {nativeStatus?.config.brutalMode ? (
                  <span className="text-[9px] text-rose-400/50 font-normal ml-1">
                    MASSIVO · L1−10%…L10−22% · S1+20%…S10+40%
                  </span>
                ) : (
                  <span className="text-[9px] text-muted-foreground/35 font-normal ml-1">
                    L1−10% L2−11% L3−12% · S1+20% S2+21% S3+22% S4+24%
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-1 max-h-[72vh] overflow-y-auto pr-2">
              {nativeLoading && nativeSymbols.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-[11px] text-muted-foreground/40">
                  <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />Carregando dados de candle...
                </div>
              ) : nativeSymbols.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-[11px] text-muted-foreground/40">
                  Nenhum símbolo configurado
                </div>
              ) : (
                nativeSymbols
                  .filter(s => !s.wouldFireLong && !s.wouldFireShort)
                  .map((sym) => (
                    <NativeSymbolCard key={sym.symbol} sym={sym} />
                  ))
              )}
            </CardContent>
          </Card>
        </section>
        </div>

      </div>
    </AppShell>
  );
}

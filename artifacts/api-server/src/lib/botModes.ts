/**
 * Bot execution modes — three preset risk/capital profiles.
 *
 * Each mode sets:
 *   leverage, marginPerTrade, marginType — applied as runtime overrides
 *
 * Mode 3 (aggressive) enables bulk execution with a token-bucket
 * rate limiter capped at MAX_ORDERS_PER_SECOND (BingX hard limit).
 *
 * ENV stays as the permanent source of truth.
 * Selecting a mode is an in-memory override that resets on restart.
 */

// ── Mode definitions ────────────────────────────────────────────────────────

export const BOT_MODES = {
  easy: {
    id: "easy" as const,
    label: "Easy",
    badge: "SCOUT",
    description: "Capital mínimo — testes seguros e calibração inicial de gates",
    leverage: 18,
    marginPerTrade: 0.50,
    marginType: "ISOLATED",
    bulkExecution: false,
    maxOrdersPerSecond: 1,
    color: "green",
    riskNote: "Nocional 9 USDT/trade. Perda máxima por SL: ~0.50 USDT. Use para validar a estratégia sem exposição real.",
  },
  standard: {
    id: "standard" as const,
    label: "Standard",
    badge: "SNIPER",
    description: "Banca média — equilíbrio entre frequência e risco por trade",
    leverage: 18,
    marginPerTrade: 2.00,
    marginType: "ISOLATED",
    bulkExecution: false,
    maxOrdersPerSecond: 1,
    color: "blue",
    riskNote: "Nocional 36 USDT/trade. Execução individual após gates. Requer ≥50 trades de telemetria para calibrar EV.",
  },
  aggressive: {
    id: "aggressive" as const,
    label: "Aggressive",
    badge: "ALPHA",
    description: "Banca alta + entradas em massa — throughput máximo respeitando rate limit da API",
    leverage: 18,
    marginPerTrade: 5.00,
    marginType: "ISOLATED",
    bulkExecution: true,
    maxOrdersPerSecond: 10, // BingX hard cap: 100 orders / 10s
    color: "orange",
    riskNote: "Nocional 90 USDT/trade. Bulk até 10 ordens/s. Exige telemetria positiva e PF ≥ 1.5 antes de ativar.",
  },
} as const;

export type BotModeId = keyof typeof BOT_MODES;
export type BotModePreset = typeof BOT_MODES[BotModeId];

// ── Active mode in-memory store ──────────────────────────────────────────────

let _activeMode: BotModeId | null = null;

export function setActiveModeId(id: BotModeId): void {
  _activeMode = id;
}

export function getActiveModeId(): BotModeId | null {
  return _activeMode;
}

export function clearActiveMode(): void {
  _activeMode = null;
}

export function getActiveModePreset(): BotModePreset | null {
  return _activeMode ? BOT_MODES[_activeMode] : null;
}

// ── Token-bucket rate limiter ────────────────────────────────────────────────
// BingX allows 100 orders per 10-second window = 10/s sustained.
// Each bulk order consume() call blocks until a token is available.

export class TokenBucket {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRatePerMs: number; // tokens per millisecond
  private lastRefill: number;

  constructor(maxTokens: number, tokensPerSecond: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRatePerMs = tokensPerSecond / 1000;
    this.lastRefill = Date.now();
  }

  /** Returns true immediately if a token was available, otherwise rejects */
  tryConsume(): boolean {
    this._refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Blocks until a token is available, then consumes it */
  async consume(): Promise<void> {
    this._refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // Compute exact wait until 1 token is available
    const deficit = 1 - this.tokens;
    const waitMs = Math.ceil(deficit / this.refillRatePerMs);
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    this._refill();
    this.tokens = Math.max(0, this.tokens - 1);
  }

  private _refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRatePerMs);
    this.lastRefill = now;
  }
}

// ── Bulk execution context ───────────────────────────────────────────────────

export interface BulkOrderItem {
  symbol: string;
  side: "BUY" | "SELL";
  positionSide: "LONG" | "SHORT";
  quantity?: number;
  btcChangePct?: number;
}

export interface BulkOrderResult {
  index: number;
  symbol: string;
  side: string;
  placed: boolean;
  orderId: string | null;
  quantity: number | null;
  gateRejects: string[];
  observationMode: boolean;
  message: string;
  durationMs: number;
}

export interface BulkExecutionSummary {
  mode: BotModeId;
  total: number;
  placed: number;
  rejected: number;
  observationMode: boolean;
  durationMs: number;
  results: BulkOrderResult[];
}

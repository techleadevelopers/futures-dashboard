# BingX Futures Terminal

`bingx-futures-terminal` is a futures execution and monitoring dashboard for selective, high-discipline scalping on BingX Perpetual Futures.

The system is designed for:

- BTC-compass-first signal filtering (trade alts in BTC direction only)
- telemetry-driven edge calibration from realized outcomes
- adaptive gate thresholds learned from historical win/loss data
- selective execution: always scanning, mostly rejecting, occasionally firing
- capital preservation over raw trade count

This is not a directional indicator bot, a signal copier, or a generic trading dashboard.

It is a **discipline engine** focused on one narrow problem:

`BTC regime signal → alt setup detection → EV/risk gate → order execution → realized PnL`

---

## Objective

The terminal continuously monitors market conditions and account state. Execution is only considered when the system believes:

- BTC direction is clear and not whipsawing (compass gate)
- the target alt is showing a qualifying setup in BTC's direction
- expected value (EV) = (win_rate × avg_win) − (loss_rate × avg_loss) > configured threshold
- the symbol does not appear in the toxicity list (symbols with negative edge historically)
- current margin exposure stays within capital controls

The terminal is intended to stay on continuously, but not to execute continuously.

Operationally it behaves as:

`always scanning → mostly rejecting → occasionally executing`

---

## Architecture Pipeline

```
BTC 5s ticker
    │
    ▼
Regime gate  ─── BEAR → block long entries, allow short entries
    │            BULL → block short entries, allow long entries
    ▼
Setup scan (symbol list)
    │
    ▼
EV gate:  EV = (WR × avgWin) − (1−WR) × |avgLoss|
    │     only pass if EV > EV_MIN_THRESHOLD
    ▼
Toxicity gate:  reject symbols with negative realized PnL over N trades
    │
    ▼
Capital gate:  reject if margin used > MAX_MARGIN_UTILIZATION
    │
    ▼
Execution → BingX REST API (signed HMAC-SHA256)
    │
    ▼
Telemetry: realized PnL, gate reason, hour, regime, symbol, fee
    │
    ▼
Adaptive calibration: recalculate WR, profit factor, EV per symbol/hour/regime
```

---

## Telemetry & Adaptive Learning

The Analysis page is the "war room" — it surfaces:

- **Win rate** (actual fills with profit data, not theoretical)
- **Profit factor** = avg_win / |avg_loss| — must be > 1.5 for viable scalp
- **EV gate quality**: is the current WR × PF combination producing positive expected value?
- **Regime breakdown**: separate WR/PF for BTC bull vs bear regimes
- **Hour-of-day toxicity**: which trading hours are profitable vs destructive
- **Symbol toxicity**: symbols with negative cumulative PnL are flagged as toxic, auto-rejected
- **Rolling edge window**: last 10 / 25 / 50 trades — edge drift detection
- **Fee drag**: total commission vs gross PnL — net PnL = gross − fee drag
- **Gate reject simulation**: what threshold would have filtered the losing trades?

The goal is to move from raw order data into a measured research loop:

`raw orders → telemetry rollup → adaptive gate recalibration → sniper execution`

---

## Execution Modes — Intelligence Presets

The bot has three built-in capital/strategy presets selectable from the **Bot** page without touching `.env`.
Each mode applies leverage, banca (margin per trade), and execution strategy as a runtime override.
Resetting returns all parameters to ENV defaults.

### Mode 1 — Easy (🔭 SCOUT)
| Parameter | Value |
|---|---|
| Banca / trade | **$0.50 USDT** |
| Leverage | **18×** ISOLATED |
| Nocional / trade | $9 USDT |
| Execution | Single entry (individual gate check) |

**Purpose:** Calibration and strategy validation with minimal real exposure. Run Easy for 50–100 trades before advancing to Standard. Losses are bounded to ~$0.50 per trade regardless of SL width.

### Mode 2 — Standard (🎯 SNIPER)
| Parameter | Value |
|---|---|
| Banca / trade | **$2.00 USDT** |
| Leverage | **18×** ISOLATED |
| Nocional / trade | $36 USDT |
| Execution | Single entry (individual gate check) |

**Purpose:** Normal operating mode once EV is positive and telemetry shows PF ≥ 1.5 from ≥50 trades. Meaningful P&L with controlled exposure per position.

### Mode 3 — Aggressive (🔥 ALPHA)
| Parameter | Value |
|---|---|
| Banca / trade | **$5.00 USDT** |
| Leverage | **18×** ISOLATED |
| Nocional / trade | $90 USDT |
| Execution | **Bulk entry** — up to 10 orders/second |
| Rate limiter | Token-bucket, hard cap 10/s (BingX API limit) |

**Purpose:** Maximum throughput when multiple symbols clear all gates simultaneously (e.g. BTC breakout + multiple alts aligning). The `/api/bot/order/bulk` endpoint accepts up to 50 orders per request and executes them sequentially through a token-bucket rate limiter so BingX's 100 orders/10s cap is never breached.

Each order in a bulk batch passes the full gate pipeline (regime, EV, win rate, capital) independently — a gate rejection on one symbol does not stop the rest of the batch.

**Safeguard:** Only activate Aggressive after:
- EV > 0 across ≥100 trades
- Profit Factor ≥ 1.5 (from Analysis page)
- Hour blacklist tuned to remove toxic sessions
- `SCALP_ALLOW_EXECUTION=true` confirmed in observation mode first

### Mode API
```
GET  /api/bot/modes              → list all presets + activeMode
POST /api/bot/mode               → { mode: "easy" | "standard" | "aggressive" }
POST /api/bot/mode/reset         → revert to ENV
POST /api/bot/order/bulk         → { orders: [...], ordersPerSecond?: 1-10 }
```

---

## Design Principles

- Reject most flow. The edge comes from what you don't enter, not just what you do.
- Bias decisions using both short-horizon state (current BTC regime) and historical outcomes (symbol WR, hour toxicity)
- Optimize for net PnL, not raw trade count
- Capital preservation > execution count. A flat day beats a blown account.
- Gate thresholds must be earned by telemetry, not guessed.

---

## Run & Operate

Local setup:

1. Install Node.js 24 and pnpm.
2. Create `.env` from `.env.example`.
3. Set at least `SESSION_SECRET` to a long random string.
4. Run `pnpm install`.

Run locally:

- `pnpm run dev:backend` - API server on `http://localhost:8080`
- `pnpm run dev:frontend` - frontend dashboard on `http://localhost:5173`
- `pnpm run typecheck` - full typecheck
- `pnpm --filter @workspace/api-spec run codegen` - regenerate API client from OpenAPI spec

The frontend Vite dev server proxies `/api` to `http://localhost:8080`, so keep backend and frontend running in separate terminals.

Database note: the current API routes persist telemetry to `telemetry.jsonl`. `DATABASE_URL` is only needed if you run the drizzle/db package commands.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + express-session + HMAC-SHA256 signing
- Frontend: React + Vite + Tailwind CSS + shadcn/ui + wouter
- BingX: REST API proxy (CORS-safe, secret never leaves server)
- Codegen: Orval from OpenAPI spec

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `artifacts/api-server/src/routes/bingx.ts` — BingX proxy with HMAC signing
- `artifacts/api-server/src/app.ts` — Express + session middleware
- `artifacts/bingx-dashboard/src/pages/analysis.tsx` — telemetry war room
- `artifacts/bingx-dashboard/src/pages/overview.tsx` — account summary
- `artifacts/bingx-dashboard/src/components/app-shell.tsx` — sidebar + BTC compass
- `lib/api-client-react/src/custom-fetch.ts` — fetch with credentials: include

## Security

- API Key + Secret stored only in server-side session (in-memory, never database)
- Secret Key never sent to frontend, never logged
- HMAC-SHA256 signed per-request with current timestamp
- Session cleared on disconnect or server restart
- Recommend read-only API key with no withdrawal permissions

## BingX API

- Base URL: `https://open-api.bingx.com`
- Docs: https://bingx-api.github.io/docs/#/en-us/swapV2/
- Auth: `X-BX-APIKEY` header + `signature` query param (HMAC-SHA256 of all params)
- BingX does NOT support username/password login via API — only API Key + Secret

## Gotchas

- BTC ticker endpoint is public (no auth), all account endpoints require session
- Session expires on server restart — reconnect required in development
- `allOrders` endpoint may not return `profit` field if the order has no position close
- BingX `positionAmt` is 0 for closed positions — filter these before displaying

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

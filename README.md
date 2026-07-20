# 🪰 Swarm the Fly

**Ultra-low-latency wallet-swarm alert bot for Robinhood Chain.**

Swarm the Fly monitors a curated set of wallets and fires an alert the moment
*multiple* tracked wallets buy or sell the **same token** inside a short time
window — coordinated accumulation, coordinated dumps, and capital rotation —
before the broader market reacts. Detection runs entirely in memory for
sub-second latency; Postgres and Redis are optional archival layers.

Built from the *Robinhood Chain Alpha Intelligence* spec and seeded with the
**Robinhood Smart-Money Conviction List** (8 tokens, 72 real tracked wallets,
5 cross-coin conviction wallets).

---

## What it does

| Capability | Detail |
|---|---|
| **Swarm detection** | ≥ N unique tracked wallets BUY the same token within a window → alert |
| **Sell detection** | ≥ N wallets SELL the same token → bearish alert |
| **Rotation detection** | wallets SELL token A then BUY token B → rotation alert |
| **Conviction score** | 0–100 from wallet quality, count, capital, velocity, liquidity, market cap, historical accuracy, buy/sell ratio |
| **Configurable rules** | min wallets, time window, min USD, min conviction, cooldown, kinds, ignored tokens/wallets, ignore dust, ignore stablecoins, ignore duplicate wallets |
| **Notifications** | Discord webhook, Telegram bot, generic REST webhook (each optional) |
| **Live dashboard** | self-contained page at `/` — live feed, swarms, alerts, leaderboards, tracked wallets, latency/health, updated over SSE |
| **REST API** | wallets, tokens, swaps, swarms, alerts, rules, leaderboards, stats, health, config |

## Architecture

```
Robinhood RPC (WebSocket)
        │
        ▼
  Chain Listener ──► Transfer Decoder ──► Wallet Filter
        │                                     │
        │                                     ▼
        │                            Aggregation Engine  (in-memory, windowed)
        │                                     │
        │                                     ▼
        │                            Conviction Engine  (0–100)
        │                                     │
        │                                     ▼
        │                              Alert Engine  (rules + cooldowns)
        │                                     │
        ├──► metrics ──► Store ◄──────────────┤
        │                 │                   ▼
        │                 │            Notifications (Discord / Telegram / Webhook)
        │                 ▼
        │        Postgres + Redis (optional write-behind)
        ▼
   SSE / REST ──► Dashboard
```

When `CHAIN_WS_URL` is unset the bot runs in **simulator mode**, replaying
synthetic coordinated swaps against the seeded wallets so the whole pipeline
(detection → conviction → alerts → dashboard) is exercised with zero external
dependencies.

## Quick start

```bash
npm install
cp .env.example .env        # optional — sensible defaults, simulator mode
npm run dev                 # hot-reload dev server
# or
npm run build && npm start  # production
```

Open **http://localhost:8080** for the dashboard.

### Point it at a live chain

```bash
CHAIN_WS_URL=wss://<robinhood-chain-rpc> CHAIN_MODE=live npm start
```

The listener subscribes to ERC-20 `Transfer` logs for the tracked tokens,
classifies each as a BUY (tracked wallet receiving) or SELL (tracked wallet
sending), auto-reconnects with exponential backoff, and reports block height +
RPC latency to the dashboard.

> USD notionals use a deterministic placeholder price oracle
> (`src/chain/price.ts`) since this build has no public price feed — swap in a
> real DexScreener / on-chain TWAP source there without touching any callers.

## Configuration

Everything is configured via environment variables (see `.env.example`) and
alert rules are additionally editable at runtime through the API. Key vars:

| Var | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | HTTP bind |
| `CHAIN_WS_URL` | — | Robinhood Chain WS RPC; empty ⇒ simulator |
| `CHAIN_MODE` | `auto` | `live`, `simulator`, or `auto` |
| `ALERT_MIN_WALLETS` | `3` | default swarm threshold |
| `ALERT_WINDOW_SECONDS` | `30` | default detection window |
| `ALERT_MIN_USD` / `ALERT_MIN_CONVICTION` | `0` / `0` | default gates |
| `ALERT_COOLDOWN_SECONDS` | `120` | per rule/token/kind cooldown |
| `IGNORE_DUST_USD` | `25` | drop swaps below this notional |
| `IGNORE_STABLECOINS` | `true` | ignore tokens flagged stable |
| `DISCORD_WEBHOOK_URL` | — | Discord alerts |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | — | Telegram alerts |
| `GENERIC_WEBHOOK_URL` | — | POST alert JSON anywhere |
| `DATABASE_URL` | — | enable Postgres archival |
| `REDIS_URL` | — | enable Redis cache/pubsub |

Invalid configuration fails fast at startup with a readable message.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | health check (used by Docker + Railway) |
| GET | `/api/stats` | totals, live metrics, channels |
| GET | `/api/config` | effective non-secret config |
| GET | `/api/tokens` | tracked tokens + per-token stats |
| GET/POST/DELETE | `/api/wallets[/:address]` | manage tracked wallets |
| GET | `/api/swaps` `/api/swarms` `/api/alerts` | recent activity (`?limit=`) |
| GET | `/api/leaderboard/wallets` `/api/leaderboard/tokens` | rankings |
| GET/POST/PUT/DELETE | `/api/rules[/:id]` | manage alert rules |
| GET | `/events` | SSE stream: `swap`, `swarm`, `alert`, `metrics` |

Example — add a rule that only fires on high-conviction, high-value buys:

```bash
curl -X POST localhost:8080/api/rules -H 'content-type: application/json' -d '{
  "name": "whale buys",
  "minWallets": 4,
  "windowSeconds": 45,
  "minUsd": 100000,
  "minConviction": 70,
  "cooldownSeconds": 300,
  "kinds": ["BUY"]
}'
```

## Deployment (Railway)

The repo ships a `Dockerfile` and `railway.json` (health check on `/health`,
restart-on-failure). To keep it live on Railway:

1. Create a project from this repo — Railway builds the `Dockerfile`.
2. Add env vars (at minimum a notification channel; `CHAIN_WS_URL` for live).
3. *(optional)* Add the Railway **PostgreSQL** and **Redis** plugins; set
   `DATABASE_URL` / `REDIS_URL`. Run `npm run prisma:migrate` to create tables.

The image generates the Prisma client at build time and runs migrations only
when a database is attached; without one it runs fully in-memory.

## Development

```bash
npm run dev         # watch mode
npm run typecheck   # tsc --noEmit
npm test            # vitest (detection, conviction, seed)
npm run build       # compile to dist/
```

Tests cover the swarm/rotation detection state machine, the 0–100 conviction
scoring, and the seed-data derivation (72 unique wallets, 5 cross-coin).

## Project layout

```
src/
  index.ts              entrypoint + pipeline wiring + graceful shutdown
  config/env.ts         env validation (zod) + .env loader
  data/seed.ts          tokens + wallets derived from the conviction list
  chain/                listener (live WS + simulator), decoder, price oracle
  engine/               aggregator (swarm/rotation), conviction, alert engine
  notify/               discord / telegram / webhook dispatch + formatting
  store/                in-memory store + optional Postgres/Redis persistence
  api/                  fastify server, routes, SSE, embedded dashboard
prisma/schema.prisma    optional archival schema
```

---

*Data source: Robinhood Chain (Blockscout holders + DexScreener pools). LP
pools, Permit2 and burn addresses excluded. Not financial advice.*

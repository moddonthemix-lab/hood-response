import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';

/**
 * Minimal, dependency-free `.env` loader. Values already present in the real
 * environment (e.g. injected by Railway) always win over the file.
 */
function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key in process.env) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnv();

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : /^(1|true|yes|on)$/i.test(v)));

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().finite());

const schema = z.object({
  PORT: num(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),

  CHAIN_WS_URL: z.string().default(''),
  // Public Robinhood Chain RPC (chain id 4663). Used by the HTTP polling
  // listener and for token metadata. Override with a dedicated provider
  // (Alchemy/QuickNode) for production throughput.
  CHAIN_HTTP_URL: z.string().default('https://rpc.mainnet.chain.robinhood.com'),
  CHAIN_ID: z.string().default('4663'),
  CHAIN_MODE: z.enum(['live', 'simulator', 'auto']).default('auto'),
  // HTTP polling cadence (ms) when using the HTTP listener.
  POLL_INTERVAL_MS: num(4000),
  SIM_TICK_MS: num(1500),
  SIM_SWARM_CHANCE: num(0.35),
  // Discovery mode: detect swarms on ANY token tracked wallets trade (including
  // brand-new coins), auto-registering unknown tokens. When false, only the
  // seeded/tracked tokens are watched (legacy behaviour).
  DISCOVERY_MODE: bool(true),
  // Fraction of simulated swarms that target a brand-new (unseen) token.
  SIM_DISCOVERY_CHANCE: num(0.4),

  ALERT_MIN_WALLETS: num(2),
  ALERT_WINDOW_SECONDS: num(300),
  ALERT_MIN_USD: num(0),
  ALERT_MIN_CONVICTION: num(0),
  // Solo-buy alerts: fire when a SINGLE tracked wallet buys a coin, but only
  // when its market cap is below SOLO_MAX_MARKETCAP (early low-cap gems).
  SOLO_ALERTS: bool(true),
  SOLO_MAX_MARKETCAP: num(100_000),
  // Safety filter: run each token through GoPlus token-security + a minimum
  // liquidity check before alerting, so rugs/honeypots/high-tax tokens are
  // suppressed. Set false to alert on everything.
  SAFETY_FILTER: bool(true),
  SAFETY_MIN_LIQUIDITY_USD: num(5_000),
  SAFETY_MAX_TAX_PCT: num(15),
  // Volume/momentum confirmation. Confirmed momentum boosts conviction and is
  // shown in alerts. Set MOMENTUM_MIN_VOLUME_USD > 0 to also SUPPRESS alerts on
  // tokens with 24h volume below it (0 = don't gate, keep brand-new gems).
  MOMENTUM_MIN_VOLUME_USD: num(0),
  // Fresh-pair + first-entry alerts: fire when a qualifying-tier wallet makes
  // its first-ever buy of a token whose pair is younger than the max age. The
  // purest "ground floor" signal.
  FRESH_ENTRY_ALERTS: bool(true),
  FRESH_PAIR_MAX_AGE_HOURS: num(48),
  FRESH_ENTRY_TIERS: z.string().default('alpha,beta'),
  ALERT_COOLDOWN_SECONDS: num(120),
  IGNORE_DUST_USD: num(25),
  IGNORE_STABLECOINS: bool(true),
  // Symbols never treated as gems: settlement/quote tokens (so a "buy with WETH"
  // doesn't register a spurious WETH sell) and tokenised equities the tracked
  // wallets trade heavily on Robinhood Chain. Comma-separated, case-insensitive.
  IGNORE_SYMBOLS: z
    .string()
    .default(
      'WETH,WBTC,ETH,USDC,USDT,USDG,DAI,USDB,WROB,VIRTUAL,' +
        'AAPL,TSLA,NVDA,GOOGL,GOOG,META,MSFT,AMZN,AMD,INTC,MU,NFLX,DIS,' +
        'COIN,PLTR,ORCL,CRWV,SNDK,SPCX,USAR,BE,HOOD,SPY,QQQ',
    ),

  DISCORD_WEBHOOK_URL: z.string().default(''),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_CHAT_ID: z.string().default(''),
  GENERIC_WEBHOOK_URL: z.string().default(''),

  DATABASE_URL: z.string().default(''),
  REDIS_URL: z.string().default(''),

  // DexScreener deep links + real prices. Set DEXSCREENER_CHAIN to the chain
  // slug (e.g. the Robinhood Chain slug) for direct token pages AND to unlock
  // real price / market-cap from DexScreener (the slug is needed to pick the
  // right pair). Left empty, links fall back to universal search and prices
  // stay synthetic.
  DEXSCREENER_CHAIN: z.string().default('robinhood'),
  // How often (ms) to refresh live prices from DexScreener.
  PRICE_REFRESH_MS: num(15000),
  // Block explorer base for Explorer links in alerts (Robinhood Chain Blockscout).
  EXPLORER_BASE: z.string().default('https://robinhoodchain.blockscout.com'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast with a readable message — required by the "environment validation"
  // deliverable.
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

const env = parsed.data;

/** Resolve the effective data source once, so the rest of the app is simple. */
const hasLiveSource = env.CHAIN_WS_URL.length > 0 || env.CHAIN_HTTP_URL.length > 0;
const chainMode: 'live' | 'simulator' =
  env.CHAIN_MODE === 'auto' ? (hasLiveSource ? 'live' : 'simulator') : env.CHAIN_MODE;

export const config = {
  ...env,
  chainMode,
  hasDatabase: env.DATABASE_URL.length > 0,
  hasRedis: env.REDIS_URL.length > 0,
  freshEntryTiers: env.FRESH_ENTRY_TIERS.split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean),
  ignoreSymbols: new Set(
    env.IGNORE_SYMBOLS.split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  ),
  notifications: {
    discord: env.DISCORD_WEBHOOK_URL || null,
    telegram:
      env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID
        ? { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID }
        : null,
    webhook: env.GENERIC_WEBHOOK_URL || null,
  },
} as const;

export type AppConfig = typeof config;

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
  CHAIN_HTTP_URL: z.string().default(''),
  CHAIN_ID: z.string().default(''),
  CHAIN_MODE: z.enum(['live', 'simulator', 'auto']).default('auto'),
  SIM_TICK_MS: num(1500),
  SIM_SWARM_CHANCE: num(0.35),
  // Discovery mode: detect swarms on ANY token tracked wallets trade (including
  // brand-new coins), auto-registering unknown tokens. When false, only the
  // seeded/tracked tokens are watched (legacy behaviour).
  DISCOVERY_MODE: bool(true),
  // Fraction of simulated swarms that target a brand-new (unseen) token.
  SIM_DISCOVERY_CHANCE: num(0.4),

  ALERT_MIN_WALLETS: num(3),
  ALERT_WINDOW_SECONDS: num(30),
  ALERT_MIN_USD: num(0),
  ALERT_MIN_CONVICTION: num(0),
  ALERT_COOLDOWN_SECONDS: num(120),
  IGNORE_DUST_USD: num(25),
  IGNORE_STABLECOINS: bool(true),

  DISCORD_WEBHOOK_URL: z.string().default(''),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_CHAT_ID: z.string().default(''),
  GENERIC_WEBHOOK_URL: z.string().default(''),

  DATABASE_URL: z.string().default(''),
  REDIS_URL: z.string().default(''),

  // DexScreener deep links. Set DEXSCREENER_CHAIN to the chain slug (e.g. the
  // Robinhood Chain slug) for direct token pages; left empty, links fall back to
  // DexScreener's universal address search, which works on any chain.
  DEXSCREENER_CHAIN: z.string().default(''),
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
const chainMode: 'live' | 'simulator' =
  env.CHAIN_MODE === 'auto'
    ? env.CHAIN_WS_URL
      ? 'live'
      : 'simulator'
    : env.CHAIN_MODE;

export const config = {
  ...env,
  chainMode,
  hasDatabase: env.DATABASE_URL.length > 0,
  hasRedis: env.REDIS_URL.length > 0,
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

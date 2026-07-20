import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { config } from '../config/env.js';
import { logger } from '../logger.js';
import type { MemoryStore } from '../store/memory.js';
import type { AlertEngine } from '../engine/alertEngine.js';
import type { Aggregator } from '../engine/aggregator.js';
import { configuredChannels } from '../notify/index.js';
import type { AlertRule, WalletCategory } from '../types.js';
import { DASHBOARD_HTML } from './dashboard.js';

const ADDR = /^0x[0-9a-fA-F]{40}$/;

const CATEGORIES: WalletCategory[] = [
  'developer',
  'vc',
  'whale',
  'market_maker',
  'influencer',
  'retail',
  'internal',
  'unknown',
];

const walletBody = z.object({
  address: z.string().regex(ADDR),
  label: z.string().min(1).max(120).default('Manual wallet'),
  category: z.enum(CATEGORIES as [WalletCategory, ...WalletCategory[]]).default('unknown'),
  confidence: z.number().min(0).max(1).default(0.5),
  notes: z.string().max(500).optional(),
  holdsTokens: z.array(z.string()).default([]),
});

const ruleBody = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  minWallets: z.number().int().min(1).max(1000),
  windowSeconds: z.number().min(1).max(3600),
  minUsd: z.number().min(0).default(0),
  minConviction: z.number().min(0).max(100).default(0),
  cooldownSeconds: z.number().min(0).max(86400).default(120),
  kinds: z.array(z.enum(['BUY', 'SELL', 'ROTATION'])).min(1),
  ignoredTokens: z.array(z.string()).default([]),
  ignoredWallets: z.array(z.string()).default([]),
});

export async function buildServer(
  store: MemoryStore,
  engine: AlertEngine,
  aggregator: Aggregator,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  // ── Health ────────────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    mode: store.metrics.mode,
    wsConnected: store.metrics.wsConnected,
    lastBlock: store.metrics.lastBlock,
    rpcLatencyMs: store.metrics.rpcLatencyMs,
    totals: store.totals,
  }));

  // ── Stats / config ──────────────────────────────────────────────────────────
  app.get('/api/stats', async () => ({
    totals: store.totals,
    metrics: store.metrics,
    trackedWallets: store.wallets.size,
    trackedTokens: store.tokensByAddress.size,
    rules: store.rules.size,
    channels: configuredChannels(),
  }));

  app.get('/api/config', async () => ({
    chainMode: config.chainMode,
    chainId: config.CHAIN_ID || null,
    detectionFloor: aggregator.detectionFloor,
    maxWindowSeconds: aggregator.maxWindowSeconds,
    ignoreDustUsd: config.IGNORE_DUST_USD,
    ignoreStablecoins: config.IGNORE_STABLECOINS,
    channels: configuredChannels(),
    persistence: { database: config.hasDatabase, redis: config.hasRedis },
  }));

  // ── Tokens ──────────────────────────────────────────────────────────────────
  app.get('/api/tokens', async () => {
    return [...store.tokensByAddress.values()].map((t) => ({
      ...t,
      stats: store.tokenStats.get(t.address) ?? null,
    }));
  });

  // ── Wallets ──────────────────────────────────────────────────────────────────
  app.get('/api/wallets', async (req) => {
    const q = (req.query as { category?: string }).category;
    let wallets = [...store.wallets.values()];
    if (q) wallets = wallets.filter((w) => w.category === q);
    return wallets.map((w) => ({ ...w, stats: store.walletStats.get(w.address) ?? null }));
  });

  app.get('/api/wallets/:address', async (req, reply) => {
    const address = (req.params as { address: string }).address.toLowerCase();
    const wallet = store.wallets.get(address);
    if (!wallet) return reply.code(404).send({ error: 'wallet not tracked' });
    return {
      ...wallet,
      stats: store.walletStats.get(address) ?? null,
      recentSwaps: store.recentSwaps(500).filter((s) => s.wallet === address).slice(0, 50),
    };
  });

  app.post('/api/wallets', async (req, reply) => {
    const parsed = walletBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const w = { ...parsed.data, address: parsed.data.address.toLowerCase() };
    store.wallets.set(w.address, w);
    return reply.code(201).send(w);
  });

  app.delete('/api/wallets/:address', async (req, reply) => {
    const address = (req.params as { address: string }).address.toLowerCase();
    const ok = store.wallets.delete(address);
    if (!ok) return reply.code(404).send({ error: 'wallet not tracked' });
    return { deleted: address };
  });

  // ── Feeds ────────────────────────────────────────────────────────────────────
  app.get('/api/swaps', async (req) => {
    const limit = clampLimit((req.query as { limit?: string }).limit);
    return store.recentSwaps(limit);
  });
  app.get('/api/swarms', async (req) => {
    const limit = clampLimit((req.query as { limit?: string }).limit);
    return store.recentSwarms(limit);
  });
  app.get('/api/alerts', async (req) => {
    const limit = clampLimit((req.query as { limit?: string }).limit);
    return store.recentAlerts(limit);
  });

  // ── Leaderboards ──────────────────────────────────────────────────────────────
  app.get('/api/leaderboard/wallets', async () => {
    return [...store.walletStats.entries()]
      .map(([address, s]) => ({
        address,
        label: store.wallets.get(address)?.label ?? null,
        ...s,
        netUsd: s.usdIn - s.usdOut,
        activity: s.buys + s.sells,
      }))
      .sort((a, b) => b.activity - a.activity)
      .slice(0, 25);
  });

  app.get('/api/leaderboard/tokens', async () => {
    return [...store.tokenStats.entries()]
      .map(([address, s]) => ({
        address,
        symbol: store.tokensByAddress.get(address)?.symbol ?? null,
        ...s,
        netUsd: s.usdIn - s.usdOut,
      }))
      .sort((a, b) => b.swarms - a.swarms || b.usdIn - a.usdIn)
      .slice(0, 25);
  });

  // ── Alert rules ────────────────────────────────────────────────────────────────
  app.get('/api/rules', async () => engine.listRules());

  app.post('/api/rules', async (req, reply) => {
    const parsed = ruleBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const rule: AlertRule = { ...parsed.data, id: parsed.data.id ?? cryptoId() };
    return reply.code(201).send(engine.upsertRule(rule));
  });

  app.put('/api/rules/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = ruleBody.safeParse({ ...(req.body as object), id });
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return engine.upsertRule({ ...parsed.data, id });
  });

  app.delete('/api/rules/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const ok = engine.deleteRule(id);
    if (!ok) return reply.code(404).send({ error: 'rule not found' });
    return { deleted: id };
  });

  // ── SSE live feed ──────────────────────────────────────────────────────────────
  app.get('/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    const send = (event: string) => (payload: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    const onSwap = send('swap');
    const onSwarm = send('swarm');
    const onAlert = send('alert');
    const onMetrics = send('metrics');
    store.on('swap', onSwap);
    store.on('swarm', onSwarm);
    store.on('alert', onAlert);
    store.on('metrics', onMetrics);

    const keepAlive = setInterval(() => reply.raw.write(': ping\n\n'), 15000);

    req.raw.on('close', () => {
      clearInterval(keepAlive);
      store.off('swap', onSwap);
      store.off('swarm', onSwarm);
      store.off('alert', onAlert);
      store.off('metrics', onMetrics);
    });
  });

  // ── Dashboard ────────────────────────────────────────────────────────────────
  app.get('/', async (_req, reply) => {
    reply.type('text/html').send(DASHBOARD_HTML);
  });

  app.setErrorHandler((err: unknown, _req, reply) => {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'request error',
    );
    reply.code(500).send({ error: 'internal error' });
  });

  return app;
}

function clampLimit(raw: string | undefined): number {
  const n = raw ? Number(raw) : 100;
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(500, Math.floor(n)));
}

function cryptoId(): string {
  return 'rule_' + Math.random().toString(36).slice(2, 10);
}

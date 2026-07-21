import { config } from './config/env.js';
import { logger } from './logger.js';
import { MemoryStore } from './store/memory.js';
import { PriceOracle } from './chain/price.js';
import { createListener } from './chain/listener.js';
import { Aggregator } from './engine/aggregator.js';
import { AlertEngine } from './engine/alertEngine.js';
import { attachPersistence } from './store/persistence.js';
import { buildServer } from './api/server.js';
import { configuredChannels } from './notify/index.js';
import type { Swarm, SwapEvent } from './types.js';

async function main(): Promise<void> {
  logger.info(
    {
      mode: config.chainMode,
      channels: configuredChannels(),
      database: config.hasDatabase,
      redis: config.hasRedis,
    },
    'starting Swarm the Fly',
  );

  const store = new MemoryStore();
  const price = new PriceOracle([...store.tokensByAddress.values()], store);
  price.start();
  const aggregator = new Aggregator(store, price);
  const engine = new AlertEngine(store, aggregator);

  const detachPersistence = await attachPersistence(store);

  // Refresh a swarm's market cap from the live source before it is recorded or
  // alerted, so the market cap shown is the real one (not the synthetic
  // placeholder) even for tokens the background refresher hasn't reached yet.
  const enrichSwarm = async (swarm: Swarm): Promise<void> => {
    await price.refreshNow(swarm.token);
    const token = store.tokensByAddress.get(swarm.token);
    if (token) {
      swarm.marketCap = price.marketCap(token);
      swarm.priceLive = price.isLive(swarm.token);
      swarm.dexUrl = price.dexUrl(swarm.token);
    }
  };

  // Pipeline: chain → decoder → store → aggregator → alert engine → notify.
  const handleSwap = async (swap: SwapEvent): Promise<void> => {
    // Auto-register unknown tokens so brand-new coins flow through the pipeline.
    store.ensureToken(swap.token, swap.tokenSymbol);
    // Log only meaningful (non-dust) live buys/sells — these wallets can be very
    // active in low-value tokenised assets, which would otherwise flood the log.
    if (config.chainMode === 'live' && swap.usdValue >= config.IGNORE_DUST_USD) {
      logger.info(
        { dir: swap.direction, token: swap.tokenSymbol, usd: Math.round(swap.usdValue) },
        'tracked-wallet swap',
      );
    }
    store.recordSwap(swap);

    // Multi-wallet swarms (BUY / SELL / ROTATION).
    for (const swarm of aggregator.ingest(swap)) {
      await enrichSwarm(swarm);
      store.recordSwarm(swarm);
      await engine.evaluate(swarm);
    }

    // Solo low-cap buy: record + alert only when the real market cap is low.
    const solo = aggregator.soloCandidate(swap);
    if (solo) {
      await enrichSwarm(solo);
      if (solo.marketCap > 0 && solo.marketCap < config.SOLO_MAX_MARKETCAP) {
        store.recordSwarm(solo);
        await engine.evaluate(solo);
      }
    }
  };

  const listener = createListener(store, price, (swap) => void handleSwap(swap));
  listener.start();

  const app = await buildServer(store, engine, aggregator);
  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info(
    { url: `http://${config.HOST}:${config.PORT}`, wallets: store.wallets.size },
    'Swarm the Fly is live',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down gracefully');
    listener.stop();
    price.stop();
    await app.close().catch(() => undefined);
    await detachPersistence();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err: err instanceof Error ? err.message : String(err) }, 'fatal startup error');
  process.exit(1);
});

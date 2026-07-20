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

  // Pipeline: chain → decoder → store → aggregator → alert engine → notify.
  const listener = createListener(store, price, (swap) => {
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
    for (const swarm of aggregator.ingest(swap)) {
      store.recordSwarm(swarm);
      void engine.evaluate(swarm);
    }
  });
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

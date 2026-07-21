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
import { SafetyChecker } from './chain/safety.js';
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
  const safety = new SafetyChecker();

  const enrichSwarm = async (swarm: Swarm): Promise<void> => {
    await price.refreshNow(swarm.token);
    const token = store.tokensByAddress.get(swarm.token);
    if (token) {
      // Re-sync the symbol in case DexScreener enriched a placeholder since detection.
      swarm.tokenSymbol = token.symbol;
      swarm.marketCap = price.marketCap(token);
      swarm.priceLive = price.isLive(swarm.token);
      swarm.dexUrl = price.dexUrl(swarm.token);
      swarm.priceUsd = price.priceOf(swarm.token);
      swarm.liquidityUsd = price.liquidityOf(swarm.token);
      swarm.dex = price.dexIdOf(swarm.token);
    }
    swarm.momentum = price.momentumOf(swarm.token) ?? undefined;

    // Pair age / freshness.
    const createdAt = price.pairCreatedAt(swarm.token);
    if (createdAt) {
      swarm.pairAgeHours = Math.round(((Date.now() - createdAt) / 3_600_000) * 10) / 10;
      swarm.freshPair = swarm.pairAgeHours <= config.FRESH_PAIR_MAX_AGE_HOURS;
    } else {
      swarm.pairAgeHours = null;
      swarm.freshPair = false;
    }

    // Refine conviction with REAL data now that price/liquidity/momentum are in:
    // reward low caps (more room to run), healthy liquidity, and momentum;
    // penalise dangerously thin liquidity.
    let adj = 0;
    const mc = swarm.marketCap;
    if (mc > 0) {
      if (mc < 50_000) adj += 10;
      else if (mc < 150_000) adj += 7;
      else if (mc < 500_000) adj += 4;
      else if (mc < 2_000_000) adj += 2;
    }
    const liq = swarm.liquidityUsd;
    if (liq != null) {
      if (liq >= 25_000) adj += 3;
      else if (liq < 5_000) adj -= 6;
    }
    if (swarm.freshPair) adj += 3;
    if (swarm.momentum?.confirmed) adj += swarm.momentum.boost;
    swarm.conviction = Math.max(0, Math.min(100, swarm.conviction + adj));
  };

  // Record the swarm, then alert only if it passes the safety screen (honeypot /
  // tax / liquidity). Unsafe swarms still appear on the dashboard, tagged, but
  // never reach the notification channels.
  const recordAndMaybeAlert = async (swarm: Swarm): Promise<void> => {
    // Re-check the ignore list against the (possibly enriched) symbol so a
    // tokenised equity that arrived as a placeholder can't slip through.
    if (config.ignoreSymbols.has(swarm.tokenSymbol.toUpperCase())) return;
    if (config.SAFETY_FILTER) {
      swarm.safety = await safety.check(swarm.token, price.liquidityOf(swarm.token));
    }
    store.recordSwarm(swarm);
    if (swarm.safety && !swarm.safety.ok) {
      logger.info(
        { token: swarm.tokenSymbol, fails: swarm.safety.hardFails },
        'alert suppressed by safety filter',
      );
      return;
    }
    // Optional volume gate: drop dead tokens when a minimum is configured.
    if (
      config.MOMENTUM_MIN_VOLUME_USD > 0 &&
      swarm.momentum?.volumeUsd != null &&
      swarm.momentum.volumeUsd < config.MOMENTUM_MIN_VOLUME_USD
    ) {
      logger.info(
        { token: swarm.tokenSymbol, volume: swarm.momentum.volumeUsd },
        'alert suppressed: below minimum volume',
      );
      return;
    }
    await engine.evaluate(swarm);
  };

  // Pipeline: chain → decoder → store → aggregator → alert engine → notify.
  const handleSwap = async (swap: SwapEvent): Promise<void> => {
    // Drop settlement/quote tokens and tokenised equities before anything else —
    // keeps the feed, stats, and token registry focused on real gems.
    if (config.ignoreSymbols.has(swap.tokenSymbol.toUpperCase())) return;
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
      await recordAndMaybeAlert(swarm);
    }

    // Solo low-cap buy: record + alert only when the real market cap is low.
    const solo = aggregator.soloCandidate(swap);
    if (solo) {
      await enrichSwarm(solo);
      if (
        solo.marketCap >= config.SOLO_MIN_MARKETCAP &&
        solo.marketCap <= config.SOLO_MAX_MARKETCAP
      ) {
        await recordAndMaybeAlert(solo);
      }
    }

    // Fresh-pair first entry: a qualifying-tier wallet's first buy of a token
    // whose pair is only hours old — record + alert only when the pair is fresh.
    const entry = aggregator.firstEntryCandidate(swap);
    if (entry) {
      await enrichSwarm(entry);
      if (entry.freshPair) {
        await recordAndMaybeAlert(entry);
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

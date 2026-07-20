import { config } from '../config/env.js';
import { logger } from '../logger.js';
import type { MemoryStore } from './memory.js';
import type { Alert, Swarm } from '../types.js';

/**
 * Optional write-behind persistence. The hot detection path is 100% in-memory;
 * this module only mirrors swarms/alerts into Postgres (via Prisma) and Redis
 * when the corresponding URLs are configured. Both are dynamically imported and
 * degrade to no-ops if the client isn't installed/generated, so the bot always
 * boots even with `optionalDependencies` absent.
 */
export async function attachPersistence(store: MemoryStore): Promise<() => Promise<void>> {
  const closers: Array<() => Promise<void>> = [];

  if (config.hasDatabase) {
    try {
      // Indirect specifier so tsc doesn't require the generated client to type-check.
      const prismaPkg = '@prisma/client';
      const { PrismaClient } = (await import(prismaPkg)) as { PrismaClient: new () => any };
      const prisma: any = new PrismaClient();
      await prisma.$connect();
      logger.info('postgres persistence enabled');

      store.on('swarm', (s: Swarm) => {
        prisma.swarm
          .create({
            data: {
              id: s.id,
              kind: s.kind,
              token: s.token,
              tokenSymbol: s.tokenSymbol,
              walletCount: s.walletCount,
              wallets: s.wallets,
              totalUsd: s.totalUsd,
              conviction: s.conviction,
              windowSeconds: s.windowSeconds,
              firstSeen: new Date(s.firstSeen),
              lastSeen: new Date(s.lastSeen),
            },
          })
          .catch((e: unknown) => logger.warn({ e: String(e) }, 'swarm persist failed'));
      });

      store.on('alert', (a: Alert) => {
        prisma.alert
          .create({
            data: {
              id: a.id,
              ruleId: a.ruleId,
              ruleName: a.ruleName,
              swarmId: a.swarm.id,
              kind: a.swarm.kind,
              tokenSymbol: a.swarm.tokenSymbol,
              conviction: a.swarm.conviction,
              totalUsd: a.swarm.totalUsd,
              createdAt: new Date(a.createdAt),
            },
          })
          .catch((e: unknown) => logger.warn({ e: String(e) }, 'alert persist failed'));
      });

      closers.push(() => prisma.$disconnect());
    } catch (err) {
      logger.warn({ err: String(err) }, 'DATABASE_URL set but Prisma unavailable; running in-memory');
    }
  }

  if (config.hasRedis) {
    try {
      const ioredisPkg = 'ioredis';
      const IORedis = ((await import(ioredisPkg)) as { default: new (url: string, opts: any) => any })
        .default;
      const redis: any = new IORedis(config.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 2,
      });
      await redis.connect();
      logger.info('redis cache/pubsub enabled');

      store.on('alert', (a: Alert) => {
        void redis.publish('swarm:alerts', JSON.stringify(a));
        void redis.set('swarm:stats', JSON.stringify(store.totals));
      });
      store.on('swarm', (s: Swarm) => {
        void redis.lpush('swarm:recent', JSON.stringify(s));
        void redis.ltrim('swarm:recent', 0, 199);
      });

      closers.push(async () => {
        redis.disconnect();
      });
    } catch (err) {
      logger.warn({ err: String(err) }, 'REDIS_URL set but ioredis unavailable; skipping cache');
    }
  }

  return async () => {
    for (const close of closers) {
      try {
        await close();
      } catch {
        /* ignore */
      }
    }
  };
}

import { describe, it, expect } from 'vitest';
import { PerformanceTracker } from '../engine/performance.js';
import type { Swarm } from '../types.js';

// Minimal PriceOracle stub: returns whatever price we set for a token.
function stubPrice(prices: Record<string, number>) {
  return {
    async refreshNow() {},
    priceOf: (addr: string) => prices[addr] ?? 0,
    isLive: (addr: string) => (prices[addr] ?? 0) > 0,
  } as unknown as import('../chain/price.js').PriceOracle;
}

function swarm(over: Partial<Swarm> = {}): Swarm {
  return {
    id: 'a-' + Math.random().toString(36).slice(2),
    kind: 'BUY',
    token: '0xtok',
    tokenSymbol: 'GEM',
    walletCount: 3,
    wallets: [],
    walletSummary: '2 alpha · 1 beta',
    totalUsd: 3000,
    marketCap: 60_000,
    newToken: false,
    dexUrl: 'x',
    priceLive: true,
    priceUsd: 1,
    conviction: 70,
    convictionBreakdown: {
      walletQuality: 0,
      walletCount: 0,
      totalCapital: 0,
      velocity: 0,
      liquidity: 0,
      marketCap: 0,
      historicalAccuracy: 0,
      buySellRatio: 0,
    },
    windowSeconds: 10,
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    ...over,
  };
}

describe('PerformanceTracker', () => {
  it('only tracks alerts with a live entry price', () => {
    const perf = new PerformanceTracker(stubPrice({}));
    perf.track(swarm({ priceLive: false, priceUsd: 1 }));
    perf.track(swarm({ priceLive: true, priceUsd: 0 }));
    perf.track(swarm({ priceLive: true, priceUsd: null }));
    expect(perf.list()).toHaveLength(0);
  });

  it('records peak and current return as the price moves', async () => {
    const prices: Record<string, number> = { '0xtok': 1 };
    const perf = new PerformanceTracker(stubPrice(prices));
    perf.track(swarm({ token: '0xtok', priceUsd: 1 }));

    // @ts-expect-error exercise the private sampler directly.
    prices['0xtok'] = 2; await perf.sample(); // +100%
    // @ts-expect-error
    prices['0xtok'] = 1.5; await perf.sample(); // pulled back to +50%, peak stays

    const call = perf.list()[0]!;
    expect(call.maxGainPct).toBe(100);
    expect(call.lastGainPct).toBe(50);
  });

  it('summary buckets by wallet count and repeat, with a win rate', async () => {
    const prices: Record<string, number> = { '0xwin': 1, '0xflat': 1 };
    const perf = new PerformanceTracker(stubPrice(prices));
    // A multi-wallet repeat that runs, and a solo single that goes nowhere.
    perf.track(swarm({ id: 'w', token: '0xwin', walletCount: 3, repeatCount: 3 }));
    perf.track(swarm({ id: 'f', token: '0xflat', walletCount: 1, repeatCount: 1 }));

    // @ts-expect-error private sampler
    prices['0xwin'] = 3; await perf.sample(); // +200% → a win (>= 50)

    const s = perf.summary();
    expect(s.total).toBe(2);
    const multi = s.byWalletCount.find((b) => b.label.startsWith('multi'))!;
    const solo = s.byWalletCount.find((b) => b.label.startsWith('solo'))!;
    expect(multi.count).toBe(1);
    expect(multi.winRatePct).toBe(100);
    expect(solo.winRatePct).toBe(0);
    const repeat = s.byRepeat.find((b) => b.label.startsWith('repeat'))!;
    expect(repeat.bestMaxGainPct).toBe(200);
  });
});

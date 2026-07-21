import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../store/memory.js';
import { PriceOracle } from '../chain/price.js';
import { Aggregator } from '../engine/aggregator.js';
import { AlertEngine } from '../engine/alertEngine.js';
import type { Swarm } from '../types.js';

function makeEngine(): { store: MemoryStore; agg: Aggregator; engine: AlertEngine } {
  const store = new MemoryStore();
  const price = new PriceOracle([...store.tokensByAddress.values()]);
  const agg = new Aggregator(store, price);
  const engine = new AlertEngine(store, agg);
  return { store, agg, engine };
}

function soloSwarm(token: string, marketCap: number): Swarm {
  return {
    id: 'swarm-' + Math.random().toString(36).slice(2),
    kind: 'SOLO',
    token,
    tokenSymbol: 'GEM',
    walletCount: 1,
    wallets: ['0x1'],
    walletSummary: '1 retail',
    totalUsd: 500,
    marketCap,
    conviction: 12,
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
    windowSeconds: 1,
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    newToken: true,
    dexUrl: 'https://dexscreener.com/x',
    priceLive: true,
  };
}

describe('AlertEngine', () => {
  let ctx: ReturnType<typeof makeEngine>;
  beforeEach(() => {
    ctx = makeEngine();
  });

  it('seeds a default swarm rule and a solo low-cap rule', () => {
    const ids = ctx.engine.listRules().map((r) => r.id);
    expect(ids).toContain('default');
    expect(ids).toContain('solo-lowcap');
  });

  it('keeps the multi-wallet detection floor at 2 despite the 1-wallet solo rule', () => {
    // The solo rule has minWallets 1 but must not lower the swarm threshold.
    expect(ctx.agg.detectionFloor).toBe(2);
  });

  it('fires a solo alert only when market cap is under the cap', async () => {
    const under = await ctx.engine.evaluate(soloSwarm('0xlowcap', 50_000));
    expect(under).toHaveLength(1);
    expect(under[0]!.ruleId).toBe('solo-lowcap');

    const over = await ctx.engine.evaluate(soloSwarm('0xhighcap', 250_000));
    expect(over).toHaveLength(0);

    // Below the market-cap floor (dust) → no solo alert.
    const dust = await ctx.engine.evaluate(soloSwarm('0xdust', 5_000));
    expect(dust).toHaveLength(0);
  });

  it('does not match a solo swarm against the multi-wallet default rule', async () => {
    const fired = await ctx.engine.evaluate(soloSwarm('0xzz', 40_000));
    // Only the solo rule should fire, never the default BUY/SELL/ROTATION rule.
    expect(fired.every((a) => a.ruleId === 'solo-lowcap')).toBe(true);
  });
});

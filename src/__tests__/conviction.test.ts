import { describe, it, expect } from 'vitest';
import { computeConviction } from '../engine/conviction.js';
import type { SwapEvent, TrackedToken, TrackedWallet } from '../types.js';

const token: TrackedToken = {
  address: '0xabc',
  symbol: 'TEST',
  name: 'Test',
  totalSupply: 1_000_000_000,
};

function wallet(confidence: number, coins = 1): TrackedWallet {
  return {
    address: '0x' + Math.random().toString(16).slice(2),
    label: 'w',
    category: 'retail',
    confidence,
    holdsTokens: Array.from({ length: coins }, (_, i) => `C${i}`),
  };
}

function swap(direction: 'BUY' | 'SELL', usd: number): SwapEvent {
  return {
    txHash: '0x0',
    wallet: '0x1',
    token: '0xabc',
    tokenSymbol: 'TEST',
    direction,
    amount: 1,
    usdValue: usd,
    blockNumber: 1,
    timestamp: Date.now(),
  };
}

describe('computeConviction', () => {
  it('always returns a score in 0..100', () => {
    const { score, breakdown } = computeConviction({
      wallets: [wallet(0.5)],
      swaps: [swap('BUY', 100)],
      token,
      windowSeconds: 10,
      totalUsd: 100,
      marketCap: 500_000,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    for (const v of Object.values(breakdown)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('scores a large high-quality coordinated buy higher than a lone low-quality one', () => {
    const strong = computeConviction({
      wallets: Array.from({ length: 8 }, () => wallet(0.9, 4)),
      swaps: Array.from({ length: 8 }, () => swap('BUY', 50_000)),
      token,
      windowSeconds: 8,
      totalUsd: 400_000,
      marketCap: 500_000,
    });
    const weak = computeConviction({
      wallets: [wallet(0.3, 1)],
      swaps: [swap('BUY', 30)],
      token,
      windowSeconds: 30,
      totalUsd: 30,
      marketCap: 50_000_000,
    });
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it('rewards directional purity', () => {
    const pure = computeConviction({
      wallets: [wallet(0.6), wallet(0.6)],
      swaps: [swap('BUY', 100), swap('BUY', 100)],
      token,
      windowSeconds: 5,
      totalUsd: 200,
      marketCap: 500_000,
    });
    const mixed = computeConviction({
      wallets: [wallet(0.6), wallet(0.6)],
      swaps: [swap('BUY', 100), swap('SELL', 100)],
      token,
      windowSeconds: 5,
      totalUsd: 200,
      marketCap: 500_000,
    });
    expect(pure.breakdown.buySellRatio).toBeGreaterThan(mixed.breakdown.buySellRatio);
  });
});

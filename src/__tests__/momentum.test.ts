import { describe, it, expect } from 'vitest';
import { computeMomentum } from '../chain/momentum.js';

describe('computeMomentum', () => {
  it('confirms when there is volume and price is rising', () => {
    const m = computeMomentum({ volumeUsd: 50_000, priceChange1h: 12, priceChange24h: 12, buys: 100, sells: 80 });
    expect(m.confirmed).toBe(true);
    expect(m.boost).toBeGreaterThan(0);
    expect(m.buyPressurePct).toBe(56);
  });

  it('confirms on strong buy pressure even if price is flat', () => {
    const m = computeMomentum({ volumeUsd: 20_000, priceChange1h: 0, priceChange24h: 0, buys: 90, sells: 10 });
    expect(m.confirmed).toBe(true); // 90% buys
    expect(m.buyPressurePct).toBe(90);
  });

  it('does not confirm without volume', () => {
    const m = computeMomentum({ volumeUsd: 0, priceChange1h: 20, priceChange24h: 20, buys: 10, sells: 1 });
    expect(m.confirmed).toBe(false);
    expect(m.boost).toBe(0);
  });

  it('does not confirm when dumping with sell pressure', () => {
    const m = computeMomentum({ volumeUsd: 30_000, priceChange1h: -15, priceChange24h: -15, buys: 20, sells: 80 });
    expect(m.confirmed).toBe(false);
  });

  it('caps the conviction boost at 15', () => {
    const m = computeMomentum({ volumeUsd: 1_000_000, priceChange1h: 500, priceChange24h: 500, buys: 1000, sells: 0 });
    expect(m.boost).toBeLessThanOrEqual(15);
    expect(m.confirmed).toBe(true);
  });

  it('handles missing txn data', () => {
    const m = computeMomentum({ volumeUsd: 10_000, priceChange1h: 5, priceChange24h: 5, buys: null, sells: null });
    expect(m.buyPressurePct).toBeNull();
    expect(m.confirmed).toBe(true); // rising price + volume
  });
});

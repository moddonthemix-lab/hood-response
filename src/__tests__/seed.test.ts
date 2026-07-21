import { describe, it, expect } from 'vitest';
import { SEED_TOKENS, SEED_WALLETS } from '../data/seed.js';

describe('seed data', () => {
  it('has the 8 tracked tokens', () => {
    expect(SEED_TOKENS).toHaveLength(8);
    const symbols = SEED_TOKENS.map((t) => t.symbol);
    expect(symbols).toContain('CASHCAT');
    expect(symbols).toContain('JUGGERNAUT');
    expect(symbols).toContain('WISHBONE');
  });

  it('derives 72 unique wallets', () => {
    expect(SEED_WALLETS).toHaveLength(72);
    const addrs = new Set(SEED_WALLETS.map((w) => w.address));
    expect(addrs.size).toBe(72);
  });

  it('all addresses are lowercased', () => {
    for (const w of SEED_WALLETS) expect(w.address).toBe(w.address.toLowerCase());
    for (const t of SEED_TOKENS) expect(t.address).toBe(t.address.toLowerCase());
  });

  it('identifies the 5-coin cross-conviction wallet', () => {
    const top = SEED_WALLETS.find(
      (w) => w.address === '0x9963597a9246b39b13330992f571f8378c18c262',
    );
    expect(top).toBeDefined();
    expect(top!.holdsTokens).toHaveLength(5);
    expect(top!.category).toBe('internal');
    expect(top!.confidence).toBeGreaterThan(0.8);
  });

  it('flags exactly 5 cross-coin wallets', () => {
    const multi = SEED_WALLETS.filter((w) => w.holdsTokens.length > 1);
    expect(multi).toHaveLength(5);
  });

  it('assigns every wallet a tier consistent with its best rank', () => {
    const tiers = new Set(['alpha', 'beta', 'chroma', 'delta']);
    for (const w of SEED_WALLETS) {
      expect(tiers.has(w.tier)).toBe(true);
      expect(w.rank).toBeGreaterThanOrEqual(1);
      const expected =
        w.rank <= 3 ? 'alpha' : w.rank <= 6 ? 'beta' : w.rank <= 9 ? 'chroma' : 'delta';
      expect(w.tier).toBe(expected);
    }
    // At least one wallet in each of the strongest tiers exists.
    expect(SEED_WALLETS.some((w) => w.tier === 'alpha')).toBe(true);
    expect(SEED_WALLETS.some((w) => w.tier === 'delta')).toBe(true);
  });

  it('rank-1 holders are alpha with high confidence', () => {
    const rank1 = SEED_WALLETS.filter((w) => w.rank === 1);
    expect(rank1.length).toBeGreaterThan(0);
    for (const w of rank1) {
      expect(w.tier).toBe('alpha');
      expect(w.confidence).toBeGreaterThanOrEqual(0.9);
    }
  });
});

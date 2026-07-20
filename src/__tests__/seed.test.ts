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
});

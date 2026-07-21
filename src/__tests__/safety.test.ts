import { describe, it, expect } from 'vitest';
import { evaluateSafety, type GoPlusToken } from '../chain/safety.js';

const T = { minLiquidityUsd: 5_000, maxTaxPct: 15 };

const clean: GoPlusToken = {
  is_honeypot: '0',
  buy_tax: '0',
  sell_tax: '0',
  cannot_sell_all: '0',
  cannot_buy: '0',
  is_open_source: '1',
  is_mintable: '0',
};

describe('evaluateSafety', () => {
  it('passes a clean token with good liquidity', () => {
    const r = evaluateSafety(clean, 50_000, T);
    expect(r.ok).toBe(true);
    expect(r.hardFails).toHaveLength(0);
    expect(r.source).toBe('goplus');
  });

  it('fails a honeypot', () => {
    const r = evaluateSafety({ ...clean, is_honeypot: '1' }, 50_000, T);
    expect(r.ok).toBe(false);
    expect(r.hardFails).toContain('honeypot');
  });

  it('fails a token that cannot be fully sold', () => {
    const r = evaluateSafety({ ...clean, cannot_sell_all: '1' }, 50_000, T);
    expect(r.ok).toBe(false);
  });

  it('fails high sell tax', () => {
    const r = evaluateSafety({ ...clean, sell_tax: '0.30' }, 50_000, T);
    expect(r.ok).toBe(false);
    expect(r.hardFails.some((f) => f.includes('sell tax'))).toBe(true);
    expect(r.sellTaxPct).toBe(30);
  });

  it('fails low liquidity', () => {
    const r = evaluateSafety(clean, 1_000, T);
    expect(r.ok).toBe(false);
    expect(r.hardFails.some((f) => f.includes('liquidity'))).toBe(true);
  });

  it('warns (but passes) on a mintable token', () => {
    const r = evaluateSafety({ ...clean, is_mintable: '1' }, 50_000, T);
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain('mintable');
  });

  it('degrades to liquidity-only when GoPlus is unavailable', () => {
    const ok = evaluateSafety(null, 50_000, T);
    expect(ok.source).toBe('liquidity-only');
    expect(ok.ok).toBe(true);
    expect(ok.warnings).toContain('safety data unavailable');

    const bad = evaluateSafety(null, 500, T);
    expect(bad.ok).toBe(false);
  });

  it('reports source none when nothing is known', () => {
    const r = evaluateSafety(null, null, T);
    expect(r.source).toBe('none');
    expect(r.warnings).toContain('liquidity unknown');
  });

  it('uses the Blockscout fallback when GoPlus is unavailable', () => {
    const r = evaluateSafety(null, 50_000, T, { verified: false });
    expect(r.source).toBe('blockscout');
    expect(r.warnings).toContain('unverified contract');
    expect(r.ok).toBe(true);
  });
});

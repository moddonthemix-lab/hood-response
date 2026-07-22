import { describe, it, expect } from 'vitest';
import { checkPriceSanity, PRICE_SANITY_MULTIPLE } from '../sniper/executor.js';

describe('checkPriceSanity', () => {
  it('allows a quote matching the market price exactly', () => {
    expect(checkPriceSanity(0.00003848, 0.00003848)).toBeNull();
  });

  it('allows a quote within the tolerance band', () => {
    expect(checkPriceSanity(0.00003848 * 2.9, 0.00003848)).toBeNull();
    expect(checkPriceSanity(0.00003848 / 2.9, 0.00003848)).toBeNull();
  });

  it('rejects a quote wildly higher than market — the VLADBOT case', () => {
    // Real numbers from the actual incident: quoted price implied a ~25.7x
    // worse rate than the token's live DexScreener price.
    const expected = 0.00003848 / 1893.49; // entryPriceUsd / ETH-USD at the time
    const quoted = 0.0005 / 892.5372713173507; // ethIn / tokensReceived
    const err = checkPriceSanity(quoted, expected);
    expect(err).not.toBeNull();
    expect(err).toContain('higher than market');
    expect(err).toContain('refusing buy');
  });

  it('rejects a quote wildly lower than market too', () => {
    const err = checkPriceSanity(0.00003848 / 10, 0.00003848);
    expect(err).not.toBeNull();
    expect(err).toContain('lower than market');
  });

  it('respects a custom multiple', () => {
    expect(checkPriceSanity(0.00003848 * 1.5, 0.00003848, 2)).toBeNull();
    expect(checkPriceSanity(0.00003848 * 2.5, 0.00003848, 2)).not.toBeNull();
  });

  it('is symmetric at the default multiple boundary', () => {
    const justInside = 0.00003848 * (PRICE_SANITY_MULTIPLE - 0.01);
    const justOutside = 0.00003848 * (PRICE_SANITY_MULTIPLE + 0.01);
    expect(checkPriceSanity(justInside, 0.00003848)).toBeNull();
    expect(checkPriceSanity(justOutside, 0.00003848)).not.toBeNull();
  });

  it('labels the refusal by action (buy vs sell) so the reason reads correctly either way', () => {
    const buyErr = checkPriceSanity(0.00003848 * 10, 0.00003848, PRICE_SANITY_MULTIPLE, 'buy');
    const sellErr = checkPriceSanity(0.00003848 / 10, 0.00003848, PRICE_SANITY_MULTIPLE, 'sell');
    expect(buyErr).toContain('refusing buy');
    expect(sellErr).toContain('refusing sell');
  });

  it('defaults to buy when no action is given', () => {
    const err = checkPriceSanity(0.00003848 * 10, 0.00003848);
    expect(err).toContain('refusing buy');
  });
});

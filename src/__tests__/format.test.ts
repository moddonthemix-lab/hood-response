import { describe, it, expect } from 'vitest';
import { headline, textBody, telegramHtml, KIND_EMOJI } from '../notify/format.js';
import type { Swarm } from '../types.js';

function swarm(over: Partial<Swarm> = {}): Swarm {
  return {
    id: 'a-' + Math.random().toString(36).slice(2),
    kind: 'ENTRY',
    token: '0xtok',
    tokenSymbol: 'GEM',
    walletCount: 1,
    wallets: [],
    walletSummary: '1 alpha',
    walletLabels: [],
    totalUsd: 3000,
    marketCap: 60_000,
    newToken: false,
    dexUrl: 'x',
    priceLive: true,
    priceUsd: 1,
    conviction: 85,
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

describe('PRIME formatting', () => {
  it('leaves non-PRIME alerts unchanged', () => {
    const s = swarm({ prime: false });
    expect(headline(s)).not.toContain('PRIME');
    expect(headline(s)).toContain(KIND_EMOJI.ENTRY);
    expect(textBody(s)).toContain('🪰 SWARM THE FLY 🪰');
    expect(telegramHtml(s)).not.toContain('👑');
  });

  it('crowns the headline and multiplies the kind icon for PRIME alerts', () => {
    const s = swarm({ prime: true });
    const h = headline(s);
    expect(h).toContain('👑 PRIME 👑');
    expect(h).toContain(KIND_EMOJI.ENTRY.repeat(3));
  });

  it('triples the fly in plain text and Telegram headers for PRIME alerts', () => {
    const s = swarm({ prime: true });
    expect(textBody(s)).toContain('🪰🪰🪰 SWARM THE FLY 🪰🪰🪰');
    const html = telegramHtml(s);
    expect(html).toContain('🪰🪰🪰 <b>SWARM THE FLY</b> 🪰🪰🪰');
    expect(html).toContain('👑 PRIME SIGNAL 👑');
  });

  it('does not add PRIME treatment when prime is undefined', () => {
    const s = swarm();
    delete (s as Partial<Swarm>).prime;
    expect(headline(s)).not.toContain('PRIME');
  });
});

describe('ATH market cap on the card', () => {
  it('shows the ATH and % off it when known', () => {
    const s = swarm({ marketCap: 50_000, athMarketCap: 200_000 });
    const body = textBody(s);
    expect(body).toContain('🏔️ ATH');
    expect(body).toContain('(-75%)');
  });

  it('omits the ATH line when unknown', () => {
    const s = swarm({ athMarketCap: null });
    expect(textBody(s)).not.toContain('🏔️');
  });
});

describe('buy bot links', () => {
  it('includes SGM and BSD buy links templated with the token address', () => {
    const s = swarm({ token: '0xdeadbeef' });
    const text = textBody(s);
    expect(text).toContain('Sigma_buyBot?start=x');
    expect(text).toContain('0xdeadbeef');
    expect(text).toContain('based_eth_bot?start=r_');
    const html = telegramHtml(s);
    expect(html).toContain('🎯 Buy SGM');
    expect(html).toContain('🎲 Buy BSD');
  });
});

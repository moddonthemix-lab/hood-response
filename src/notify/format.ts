import type { Swarm } from '../types.js';

export const KIND_EMOJI: Record<Swarm['kind'], string> = {
  BUY: '🟢🪰',
  SELL: '🔴🪰',
  ROTATION: '🔄🪰',
  SOLO: '🕵️🪰',
  ENTRY: '🌱🪰',
};

export function usd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

export function headline(s: Swarm): string {
  const e = KIND_EMOJI[s.kind];
  const tag = s.newToken ? '🆕 NEW COIN · ' : '';
  if (s.kind === 'ROTATION') {
    return `${e} ROTATION — ${s.walletCount} wallets rotating ${s.tokenSymbol} → ${s.rotatedIntoSymbol}`;
  }
  if (s.kind === 'SOLO') {
    return `${e} ${tag}SOLO BUY — a tracked wallet is aping ${s.tokenSymbol} (low cap)`;
  }
  if (s.kind === 'ENTRY') {
    const age = s.pairAgeHours != null ? `${s.pairAgeHours}h-old` : 'fresh';
    return `${e} ${tag}FIRST ENTRY — a top wallet just aped ${s.tokenSymbol} (${age} pair)`;
  }
  const verb = s.kind === 'BUY' ? 'accumulating' : 'dumping';
  return `${e} ${tag}SWARM — ${s.walletCount} wallets ${verb} ${s.tokenSymbol}`;
}

/** Plain-text alert body shared by Telegram + generic webhooks. */
export function textBody(s: Swarm): string {
  const action = s.kind === 'SELL' ? 'Sold at MC' : 'Bought at MC';
  const mc = `${usd(s.marketCap)}${s.priceLive ? '' : ' (est)'}`;
  const lines = [
    headline(s),
    ``,
    `Conviction: ${s.conviction}/100`,
    `Notional: ${usd(s.totalUsd)}`,
    `${action}: ${mc}`,
    `Window: ${s.windowSeconds}s`,
    `Wallets: ${s.walletSummary}`,
  ];
  // Volume / momentum confirmation.
  if (s.momentum && s.momentum.volumeUsd != null) {
    const chg =
      s.momentum.priceChangePct != null
        ? `${s.momentum.priceChangePct >= 0 ? '+' : ''}${s.momentum.priceChangePct.toFixed(1)}%`
        : '?';
    const bp = s.momentum.buyPressurePct != null ? `${s.momentum.buyPressurePct}% buys` : '';
    const flag = s.momentum.confirmed ? ' 🔥' : '';
    lines.push(`Volume 24h: ${usd(s.momentum.volumeUsd)} · ${chg} · ${bp}${flag}`.trimEnd());
  }
  // Safety summary (alerts only fire when the token passed the screen).
  if (s.safety) {
    const liq = s.safety.liquidityUsd != null ? usd(s.safety.liquidityUsd) : '?';
    const bt = s.safety.buyTaxPct != null ? Math.round(s.safety.buyTaxPct) : '?';
    const st = s.safety.sellTaxPct != null ? Math.round(s.safety.sellTaxPct) : '?';
    lines.push(`Liquidity: ${liq} · Tax ${bt}/${st}% · ✅ passed safety`);
    if (s.safety.warnings.length) lines.push(`⚠️ ${s.safety.warnings.join(', ')}`);
  }
  // Fresh-pair context.
  if (s.freshPair && s.pairAgeHours != null) lines.push(`🌱 Fresh pair: ${s.pairAgeHours}h old`);
  // For freshly discovered coins, surface the contract so it's actionable.
  if (s.newToken) lines.push(`Contract: ${s.token}`);
  lines.push(`Chart: ${s.dexUrl}`);
  return lines.join('\n');
}

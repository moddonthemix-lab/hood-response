import type { Swarm } from '../types.js';

export const KIND_EMOJI: Record<Swarm['kind'], string> = {
  BUY: '🟢🪰',
  SELL: '🔴🪰',
  ROTATION: '🔄🪰',
};

export function usd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

export function headline(s: Swarm): string {
  const e = KIND_EMOJI[s.kind];
  if (s.kind === 'ROTATION') {
    return `${e} ROTATION — ${s.walletCount} wallets rotating ${s.tokenSymbol} → ${s.rotatedIntoSymbol}`;
  }
  const tag = s.newToken ? '🆕 NEW COIN · ' : '';
  const verb = s.kind === 'BUY' ? 'accumulating' : 'dumping';
  return `${e} ${tag}SWARM — ${s.walletCount} wallets ${verb} ${s.tokenSymbol}`;
}

/** Plain-text alert body shared by Telegram + generic webhooks. */
export function textBody(s: Swarm): string {
  const action = s.kind === 'SELL' ? 'Sold at MC' : 'Bought at MC';
  const lines = [
    headline(s),
    ``,
    `Conviction: ${s.conviction}/100`,
    `Notional: ${usd(s.totalUsd)}`,
    `${action}: ${usd(s.marketCap)}`,
    `Window: ${s.windowSeconds}s`,
    `Wallets: ${s.walletSummary}`,
  ];
  // For freshly discovered coins, surface the contract so it's actionable.
  if (s.newToken) lines.push(`Contract: ${s.token}`);
  return lines.join('\n');
}

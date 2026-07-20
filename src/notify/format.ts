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

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function headline(s: Swarm): string {
  const e = KIND_EMOJI[s.kind];
  if (s.kind === 'ROTATION') {
    return `${e} ROTATION — ${s.walletCount} wallets rotating ${s.tokenSymbol} → ${s.rotatedIntoSymbol}`;
  }
  const verb = s.kind === 'BUY' ? 'accumulating' : 'dumping';
  return `${e} SWARM — ${s.walletCount} wallets ${verb} ${s.tokenSymbol}`;
}

/** Plain-text alert body shared by Telegram + generic webhooks. */
export function textBody(s: Swarm): string {
  const lines = [
    headline(s),
    ``,
    `Conviction: ${s.conviction}/100`,
    `Notional: ${usd(s.totalUsd)}`,
    `Window: ${s.windowSeconds}s`,
    `Wallets: ${s.wallets.map(shortAddr).join(', ')}`,
  ];
  return lines.join('\n');
}

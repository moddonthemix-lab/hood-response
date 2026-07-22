import type { Swarm } from '../types.js';
import { explorerUrl } from '../links.js';

export const KIND_EMOJI: Record<Swarm['kind'], string> = {
  BUY: '🟢🪰',
  SELL: '🔴🪰',
  ROTATION: '🔄🪰',
  SOLO: '🕵️🪰',
  ENTRY: '🌱🪰',
};

/** PRIME multiplies the kind icon itself — the swarm literally gets bigger. */
function primeIcon(s: Swarm): string {
  return s.prime ? KIND_EMOJI[s.kind].repeat(3) : KIND_EMOJI[s.kind];
}

// ── formatting helpers ────────────────────────────────────────────────────────
export function usd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

/** Compact number without a currency sign: 388100 → "388.1K". */
function compact(n: number | null | undefined): string {
  if (n == null) return '?';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

function fmtPrice(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return '?';
  if (p >= 1) return p.toFixed(4);
  return p.toPrecision(4).replace(/0+$/, '');
}

function fmtAge(hours: number | null | undefined): string {
  if (hours == null) return '?';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function pct(v: number | null | undefined): string {
  if (v == null) return '?';
  const dot = v >= 0 ? '🟢' : '🔴';
  return `${dot} ${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

/** 5-segment conviction bar. */
function convBar(score: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(score / 20)));
  return '🟩'.repeat(filled) + '⬜'.repeat(5 - filled);
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th" … */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Prominent repeat/escalation lines, or [] when this is the first alert on the
 *  token inside the window (nothing to escalate). A repeat driven by a NEW
 *  distinct holder is highlighted harder than the same wallet buying again, and
 *  the price move since the previous alert is shown when known. */
function repeatLines(s: Swarm): string[] {
  const n = s.repeatCount ?? 0;
  if (n < 2) return [];
  const win = s.repeatWindowMinutes ?? 35;
  const w = s.repeatWallets ?? n;
  const lines: string[] = [];
  if (s.repeatNewWallet) {
    // A different top holder just joined — the strongest repeat signal.
    lines.push(`🚨 NEW HOLDER IN 🪰🔥 · ${ordinal(n)} alert · ${w} wallet${w > 1 ? 's' : ''} in ${win}m`);
  } else {
    const heat = n >= 4 ? '🔥🔥' : '🔥';
    lines.push(`🔁 REPEAT x${n} ${heat} · ${ordinal(n)} alert in ${win}m`);
  }
  const pc = s.repeatPriceChangePct;
  if (pc != null) {
    const arrow = pc > 0 ? '📈' : pc < 0 ? '📉' : '➡️';
    lines.push(`${arrow} ${pc > 0 ? '+' : ''}${pc}% since last alert`);
  }
  return lines;
}

function typeTitle(s: Swarm): string {
  const nu = s.newToken ? '🆕 NEW COIN · ' : '';
  switch (s.kind) {
    case 'ROTATION':
      return `🔄 ROTATION · ${s.walletCount} wallets → ${s.rotatedIntoSymbol}`;
    case 'SOLO':
      return `${nu}🕵️ SOLO BUY · low-cap ape`;
    case 'ENTRY':
      return `${nu}🌱 FIRST ENTRY · ${fmtAge(s.pairAgeHours)}-old pair`;
    case 'SELL':
      return `${nu}🔴 SELL SWARM · ${s.walletCount} wallets dumping`;
    default:
      return `${nu}🟢 SWARM · ${s.walletCount} wallets accumulating`;
  }
}

export function headline(s: Swarm): string {
  return s.prime
    ? `👑 PRIME 👑 ${primeIcon(s)} ${typeTitle(s)}`
    : `${KIND_EMOJI[s.kind]} ${typeTitle(s)}`;
}

/** The loud, fly-swarming banner PRIME alerts open with — more flies, and the
 *  alert icon itself multiplies (3x), same idea as the header. */
function primeBanner(s: Swarm): string[] {
  if (!s.prime) return [];
  const swarm = '🪰'.repeat(9);
  return [swarm, `👑 PRIME SIGNAL 👑 ${primeIcon(s)}`, swarm];
}

/** The card's stacked display lines (no links; shared by plain + HTML). */
function cardLines(s: Swarm): string[] {
  const sym = s.tokenSymbol;
  const marker = s.kind === 'SELL' ? '🔻' : s.kind === 'ENTRY' ? '🌱' : '🩸';
  const buys = s.momentum?.buys ?? null;
  const sells = s.momentum?.sells ?? null;

  const prime = primeBanner(s);
  const repeat = repeatLines(s);
  const lines: string[] = [
    ...(prime.length ? [...prime, ``] : []),
    ...(repeat.length ? [...repeat, ``] : []),
    `${marker} ${sym} [${compact(s.marketCap)}] $${sym}`,
    `⛓️ Robinhood · ${s.dex ?? 'dex'}`,
    `💰 $${fmtPrice(s.priceUsd)}`,
    `💎 MC ${compact(s.marketCap)}${s.priceLive ? '' : ' (est)'}  ·  💧 Liq ${compact(s.liquidityUsd)}`,
    `📊 Vol ${compact(s.momentum?.volumeUsd)}  ·  ⏳ Age ${fmtAge(s.pairAgeHours)}`,
    `📈 24h ${pct(s.momentum?.priceChange24h)}  ·  1h ${pct(s.momentum?.priceChange1h)}  ·  🅑 ${buys ?? '?'} 🅢 ${sells ?? '?'}`,
    ``,
    `🐝 CONVICTION ${s.conviction}/100${s.momentum?.confirmed ? ' 🔥' : ''}`,
    convBar(s.conviction),
    `👛 ${s.walletSummary}`,
  ];

  if (s.safety) {
    const bt = s.safety.buyTaxPct != null ? Math.round(s.safety.buyTaxPct) : '?';
    const st = s.safety.sellTaxPct != null ? Math.round(s.safety.sellTaxPct) : '?';
    lines.push(`🛡️ Safe · Tax ${bt}/${st}%${s.safety.warnings.length ? ` · ⚠️ ${s.safety.warnings.join(', ')}` : ''}`);
  }
  if (s.alsoHold && s.alsoHold.length) {
    lines.push(`⭐ Wallets also hold: ${s.alsoHold.join(', ')}`);
  }
  return lines;
}

// ── plain text (generic webhooks) ─────────────────────────────────────────────
export function textBody(s: Swarm): string {
  const fly = s.prime ? '🪰'.repeat(3) : '🪰';
  const lines = [`${fly} SWARM THE FLY ${fly}`, typeTitle(s), ``, ...cardLines(s), ``, s.token];
  lines.push(`📊 Chart: ${s.dexUrl}`);
  lines.push(`🔎 Explorer: ${explorerUrl(s.token)}`);
  return lines.join('\n');
}

// ── Telegram HTML card ────────────────────────────────────────────────────────
const esc = (str: string): string =>
  str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function telegramHtml(s: Swarm): string {
  const body = cardLines(s).map(esc).join('\n');
  const fly = s.prime ? '🪰'.repeat(3) : '🪰';
  return (
    `${fly} <b>SWARM THE FLY</b> ${fly}\n` +
    `<b>${esc(typeTitle(s))}</b>\n\n` +
    `${body}\n\n` +
    `<code>${esc(s.token)}</code>\n` +
    `📊 <a href="${esc(s.dexUrl)}">Chart</a>  ·  🔎 <a href="${esc(explorerUrl(s.token))}">Explorer</a>`
  );
}

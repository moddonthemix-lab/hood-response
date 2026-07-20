import { config } from '../config/env.js';
import { logger } from '../logger.js';
import type { NotificationDelivery, Swarm } from '../types.js';
import { KIND_EMOJI, headline, textBody, usd } from './format.js';

const TIMEOUT_MS = 4000;

async function postJson(url: string, body: unknown): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

async function sendDiscord(url: string, s: Swarm): Promise<NotificationDelivery> {
  const color = s.kind === 'BUY' ? 0x16a34a : s.kind === 'SELL' ? 0xdc2626 : 0x7c3aed;
  const embed = {
    title: headline(s),
    color,
    fields: [
      { name: 'Conviction', value: `${s.conviction}/100`, inline: true },
      { name: 'Notional', value: usd(s.totalUsd), inline: true },
      {
        name: s.kind === 'SELL' ? 'Sold at MC' : 'Bought at MC',
        value: usd(s.marketCap),
        inline: true,
      },
      { name: 'Window', value: `${s.windowSeconds}s`, inline: true },
      { name: `Wallets (${s.walletCount})`, value: s.walletSummary, inline: true },
      ...(s.newToken ? [{ name: '🆕 Contract', value: s.token }] : []),
    ],
    footer: { text: 'Swarm the Fly · Robinhood Chain' },
    timestamp: new Date(s.lastSeen).toISOString(),
  };
  try {
    const res = await postJson(url, { username: 'Swarm the Fly', embeds: [embed] });
    return delivery('discord', res.ok, res.ok ? undefined : `HTTP ${res.status}`);
  } catch (err) {
    return delivery('discord', false, (err as Error).message);
  }
}

async function sendTelegram(
  token: string,
  chatId: string,
  s: Swarm,
): Promise<NotificationDelivery> {
  try {
    const res = await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: `${KIND_EMOJI[s.kind]} ${textBody(s)}`,
      disable_web_page_preview: true,
    });
    return delivery('telegram', res.ok, res.ok ? undefined : `HTTP ${res.status}`);
  } catch (err) {
    return delivery('telegram', false, (err as Error).message);
  }
}

async function sendWebhook(url: string, s: Swarm): Promise<NotificationDelivery> {
  try {
    const res = await postJson(url, { type: 'swarm.alert', text: textBody(s), swarm: s });
    return delivery('webhook', res.ok, res.ok ? undefined : `HTTP ${res.status}`);
  } catch (err) {
    return delivery('webhook', false, (err as Error).message);
  }
}

function delivery(
  channel: NotificationDelivery['channel'],
  ok: boolean,
  detail?: string,
): NotificationDelivery {
  return { channel, ok, detail, at: Date.now() };
}

/**
 * Fan a swarm out to every configured channel in parallel. Unconfigured
 * channels are silently skipped; a failing channel never blocks the others.
 */
export async function dispatch(s: Swarm): Promise<NotificationDelivery[]> {
  const jobs: Promise<NotificationDelivery>[] = [];
  if (config.notifications.discord) jobs.push(sendDiscord(config.notifications.discord, s));
  if (config.notifications.telegram) {
    jobs.push(
      sendTelegram(config.notifications.telegram.token, config.notifications.telegram.chatId, s),
    );
  }
  if (config.notifications.webhook) jobs.push(sendWebhook(config.notifications.webhook, s));

  if (jobs.length === 0) {
    logger.debug({ swarm: s.id }, 'no notification channels configured; alert stored only');
    return [];
  }
  const results = await Promise.all(jobs);
  for (const r of results) {
    if (!r.ok) logger.warn({ channel: r.channel, detail: r.detail }, 'notification failed');
  }
  return results;
}

export function configuredChannels(): string[] {
  const out: string[] = [];
  if (config.notifications.discord) out.push('discord');
  if (config.notifications.telegram) out.push('telegram');
  if (config.notifications.webhook) out.push('webhook');
  return out;
}

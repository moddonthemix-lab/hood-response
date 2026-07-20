import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import { logger } from '../logger.js';
import type { MemoryStore } from '../store/memory.js';
import type { Alert, AlertRule, Swarm } from '../types.js';
import { dispatch } from '../notify/index.js';
import type { Aggregator } from './aggregator.js';

function defaultRule(): AlertRule {
  return {
    id: 'default',
    name: 'Default swarm rule',
    enabled: true,
    minWallets: config.ALERT_MIN_WALLETS,
    windowSeconds: config.ALERT_WINDOW_SECONDS,
    minUsd: config.ALERT_MIN_USD,
    minConviction: config.ALERT_MIN_CONVICTION,
    cooldownSeconds: config.ALERT_COOLDOWN_SECONDS,
    kinds: ['BUY', 'SELL', 'ROTATION'],
    ignoredTokens: [],
    ignoredWallets: [],
  };
}

/**
 * Turns raw swarm candidates into alerts by evaluating them against the set of
 * configurable rules, enforcing per-rule cooldowns, and fanning out to the
 * notification channels. Rule changes are pushed back into the aggregator so
 * its detection floor / window always covers the least-restrictive rule.
 */
export class AlertEngine {
  /** cooldown key -> last fire timestamp (ms). */
  private readonly cooldowns = new Map<string, number>();

  constructor(
    private readonly store: MemoryStore,
    private readonly aggregator: Aggregator,
  ) {
    if (this.store.rules.size === 0) this.store.rules.set('default', defaultRule());
    this.syncAggregator();
  }

  /** Keep the aggregator's detection floor/window aligned with enabled rules. */
  private syncAggregator(): void {
    const enabled = [...this.store.rules.values()].filter((r) => r.enabled);
    if (enabled.length === 0) return;
    this.aggregator.detectionFloor = Math.max(
      1,
      Math.min(...enabled.map((r) => r.minWallets)),
    );
    this.aggregator.maxWindowSeconds = Math.max(...enabled.map((r) => r.windowSeconds));
  }

  listRules(): AlertRule[] {
    return [...this.store.rules.values()];
  }

  upsertRule(rule: AlertRule): AlertRule {
    this.store.rules.set(rule.id, rule);
    this.syncAggregator();
    return rule;
  }

  deleteRule(id: string): boolean {
    const ok = this.store.rules.delete(id);
    if (ok) this.syncAggregator();
    return ok;
  }

  private matches(rule: AlertRule, swarm: Swarm): boolean {
    if (!rule.enabled) return false;
    if (!rule.kinds.includes(swarm.kind)) return false;
    if (rule.ignoredTokens.includes(swarm.token)) return false;
    if (swarm.windowSeconds > rule.windowSeconds) return false;

    const ignored = new Set(rule.ignoredWallets.map((w) => w.toLowerCase()));
    const effective = swarm.wallets.filter((w) => !ignored.has(w));
    if (effective.length < rule.minWallets) return false;
    if (swarm.totalUsd < rule.minUsd) return false;
    if (swarm.conviction < rule.minConviction) return false;
    return true;
  }

  private cooled(rule: AlertRule, swarm: Swarm, now: number): boolean {
    const key = `${rule.id}:${swarm.token}:${swarm.kind}`;
    const last = this.cooldowns.get(key) ?? 0;
    if (now - last < rule.cooldownSeconds * 1000) return false;
    this.cooldowns.set(key, now);
    return true;
  }

  /** Evaluate a detected swarm against all rules and fire alerts as needed. */
  async evaluate(swarm: Swarm): Promise<Alert[]> {
    const now = Date.now();
    const fired: Alert[] = [];
    for (const rule of this.store.rules.values()) {
      if (!this.matches(rule, swarm)) continue;
      if (!this.cooled(rule, swarm, now)) continue;

      const alert: Alert = {
        id: randomUUID(),
        ruleId: rule.id,
        ruleName: rule.name,
        swarm,
        createdAt: now,
        deliveries: [],
      };
      this.store.recordAlert(alert);
      logger.info(
        { rule: rule.name, kind: swarm.kind, token: swarm.tokenSymbol, conviction: swarm.conviction },
        'ALERT fired',
      );
      // Deliver asynchronously; attach results when they land.
      void dispatch(swarm).then((deliveries) => {
        alert.deliveries = deliveries;
      });
      fired.push(alert);
    }
    return fired;
  }
}

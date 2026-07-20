import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import type { MemoryStore } from '../store/memory.js';
import type { PriceOracle } from '../chain/price.js';
import type { Swarm, SwapEvent } from '../types.js';
import { computeConviction } from './conviction.js';

interface WindowState {
  events: SwapEvent[];
  lastEmittedWallets: number;
}

/**
 * In-memory, time-windowed aggregation engine. Every swap is bucketed by
 * (token, direction); when the count of *unique* tracked wallets in the live
 * window crosses the detection floor, a swarm candidate is produced. Rotations
 * are detected when a fresh buy-swarm's wallets recently sold a different token.
 *
 * The engine never emits the same swarm twice for the same wallet set — it only
 * re-emits when the set grows — and it holds everything in memory so the hot
 * path stays sub-millisecond.
 */
export class Aggregator {
  private readonly windows = new Map<string, WindowState>();

  /** Detection floor = smallest wallet threshold across all enabled rules. */
  detectionFloor = config.ALERT_MIN_WALLETS;
  /** Widest window (seconds) any rule cares about; bounds pruning. */
  maxWindowSeconds = config.ALERT_WINDOW_SECONDS;

  constructor(
    private readonly store: MemoryStore,
    private readonly price: PriceOracle,
  ) {}

  private key(token: string, direction: string): string {
    return `${token}:${direction}`;
  }

  private prune(now: number): void {
    const cutoff = now - this.maxWindowSeconds * 1000;
    for (const [key, state] of this.windows) {
      state.events = state.events.filter((e) => e.timestamp >= cutoff);
      if (state.events.length === 0) {
        this.windows.delete(key);
      } else {
        // If the window drained below the last emit size, allow re-emit later.
        const unique = new Set(state.events.map((e) => e.wallet)).size;
        if (unique < state.lastEmittedWallets) state.lastEmittedWallets = unique;
      }
    }
  }

  /** Should this swap be considered for swarm detection? */
  private eligible(swap: SwapEvent): boolean {
    if (config.IGNORE_DUST_USD > 0 && swap.usdValue < config.IGNORE_DUST_USD) {
      return false;
    }
    if (config.IGNORE_STABLECOINS) {
      const token = this.store.tokensByAddress.get(swap.token);
      if (token?.stable) return false;
    }
    return this.store.isTracked(swap.wallet);
  }

  /** Feed one swap; returns any swarms detected as a result. */
  ingest(swap: SwapEvent): Swarm[] {
    if (!this.eligible(swap)) return [];
    this.prune(swap.timestamp);

    const key = this.key(swap.token, swap.direction);
    const state = this.windows.get(key) ?? { events: [], lastEmittedWallets: 0 };
    state.events.push(swap);
    this.windows.set(key, state);

    const swarms: Swarm[] = [];
    const direct = this.detectDirect(key, state, swap);
    if (direct) {
      swarms.push(direct);
      const rotation = this.detectRotation(direct);
      if (rotation) swarms.push(rotation);
    }
    return swarms;
  }

  private detectDirect(key: string, state: WindowState, swap: SwapEvent): Swarm | null {
    // Latest swap per unique wallet (ignore duplicate wallets rule).
    const latest = new Map<string, SwapEvent>();
    for (const e of state.events) latest.set(e.wallet, e);
    const uniqueCount = latest.size;

    if (uniqueCount < this.detectionFloor) return null;
    if (uniqueCount <= state.lastEmittedWallets) return null;
    state.lastEmittedWallets = uniqueCount;

    return this.buildSwarm(swap.direction === 'BUY' ? 'BUY' : 'SELL', swap.token, [
      ...latest.values(),
    ]);
  }

  private detectRotation(buySwarm: Swarm): Swarm | null {
    if (buySwarm.kind !== 'BUY') return null;
    const buyers = new Set(buySwarm.wallets);

    // Look for a recent SELL window (different token) sharing enough wallets.
    for (const [key, state] of this.windows) {
      const [token, direction] = key.split(':');
      if (direction !== 'SELL' || token === buySwarm.token) continue;
      const sellers = new Map<string, SwapEvent>();
      for (const e of state.events) if (buyers.has(e.wallet)) sellers.set(e.wallet, e);
      if (sellers.size < this.detectionFloor) continue;

      const swarm = this.buildSwarm('ROTATION', token!, [...sellers.values()]);
      swarm.rotatedIntoSymbol = buySwarm.tokenSymbol;
      return swarm;
    }
    return null;
  }

  private buildSwarm(kind: Swarm['kind'], tokenAddr: string, events: SwapEvent[]): Swarm {
    const token = this.store.tokensByAddress.get(tokenAddr)!;
    const wallets = events.map((e) => e.wallet);
    const walletObjs = wallets
      .map((a) => this.store.wallets.get(a))
      .filter((w): w is NonNullable<typeof w> => Boolean(w));
    const totalUsd = events.reduce((s, e) => s + e.usdValue, 0);
    const timestamps = events.map((e) => e.timestamp);
    const firstSeen = Math.min(...timestamps);
    const lastSeen = Math.max(...timestamps);
    const windowSeconds = Math.max((lastSeen - firstSeen) / 1000, 0.001);

    const { score, breakdown } = computeConviction({
      wallets: walletObjs,
      swaps: events,
      token,
      windowSeconds,
      totalUsd,
      marketCap: this.price.marketCap(token),
    });

    return {
      id: randomUUID(),
      kind,
      token: token.address,
      tokenSymbol: token.symbol,
      walletCount: wallets.length,
      wallets,
      totalUsd,
      conviction: score,
      convictionBreakdown: breakdown,
      windowSeconds: Number(windowSeconds.toFixed(2)),
      firstSeen,
      lastSeen,
    };
  }
}

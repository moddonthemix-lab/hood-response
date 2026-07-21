import { config } from '../config/env.js';
import { logger } from '../logger.js';
import type { PriceOracle } from '../chain/price.js';
import type { Swarm, SwarmKind } from '../types.js';

/**
 * A single alert being followed after it fired, so we can measure whether it
 * actually turned into a runner. Entry price is captured at alert time; the
 * tracker re-samples the live price on a timer and records the peak and the
 * milestone returns. No wallet addresses are retained — safe to expose.
 */
export interface TrackedCall {
  id: string;
  token: string;
  tokenSymbol: string;
  kind: SwarmKind;
  conviction: number;
  walletCount: number;
  walletSummary: string;
  /** Distinct-wallet repeat signal at alert time (from the repeat counter). */
  repeatCount: number;
  repeatWallets: number;
  newHolder: boolean;
  entryPrice: number;
  entryMarketCap: number;
  entryAt: number;
  lastPrice: number;
  /** Current return vs entry (%). */
  lastGainPct: number;
  maxPrice: number;
  /** Best return seen since the alert (%). */
  maxGainPct: number;
  maxGainAt: number;
  /** Milestone returns (%), filled as the token ages past each mark. */
  gain1hPct: number | null;
  gain6hPct: number | null;
  gain24hPct: number | null;
  updatedAt: number;
  /** True once tracking has run its course (past PERF_TRACK_HOURS). */
  closed: boolean;
}

interface Bucket {
  label: string;
  count: number;
  avgMaxGainPct: number;
  medianMaxGainPct: number;
  bestMaxGainPct: number;
  /** Share that reached the win threshold (%). */
  winRatePct: number;
}

const gainPct = (entry: number, now: number): number =>
  entry > 0 ? Math.round(((now - entry) / entry) * 1000) / 10 : 0;

function bucket(label: string, calls: TrackedCall[], winThreshold: number): Bucket {
  if (calls.length === 0) {
    return { label, count: 0, avgMaxGainPct: 0, medianMaxGainPct: 0, bestMaxGainPct: 0, winRatePct: 0 };
  }
  const gains = calls.map((c) => c.maxGainPct).sort((a, b) => a - b);
  const sum = gains.reduce((s, g) => s + g, 0);
  const mid = Math.floor(gains.length / 2);
  const median = gains.length % 2 ? gains[mid]! : (gains[mid - 1]! + gains[mid]!) / 2;
  const wins = calls.filter((c) => c.maxGainPct >= winThreshold).length;
  return {
    label,
    count: calls.length,
    avgMaxGainPct: Math.round((sum / calls.length) * 10) / 10,
    medianMaxGainPct: Math.round(median * 10) / 10,
    bestMaxGainPct: gains[gains.length - 1]!,
    winRatePct: Math.round((wins / calls.length) * 1000) / 10,
  };
}

/**
 * Follows every fired alert and records how the token actually performed, so
 * signal quality can be measured from real outcomes instead of guessed. The
 * summary breaks results down by the dimensions that matter for catching
 * runners — multi-wallet vs solo, and repeat vs single — so the operator can
 * see which setups pay.
 */
export class PerformanceTracker {
  private readonly calls = new Map<string, TrackedCall>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly price: PriceOracle) {}

  /** Register a fired alert for follow-up. No-op unless we have a live entry
   *  price (synthetic prices can't be measured against the market). */
  track(swarm: Swarm): void {
    if (!config.PERFORMANCE_TRACKING) return;
    const entryPrice = swarm.priceUsd ?? 0;
    if (!swarm.priceLive || !(entryPrice > 0)) return;
    if (this.calls.has(swarm.id)) return;
    const now = Date.now();
    this.calls.set(swarm.id, {
      id: swarm.id,
      token: swarm.token,
      tokenSymbol: swarm.tokenSymbol,
      kind: swarm.kind,
      conviction: swarm.conviction,
      walletCount: swarm.walletCount,
      walletSummary: swarm.walletSummary,
      repeatCount: swarm.repeatCount ?? 1,
      repeatWallets: swarm.repeatWallets ?? swarm.walletCount,
      newHolder: swarm.repeatNewWallet ?? false,
      entryPrice,
      entryMarketCap: swarm.marketCap,
      entryAt: now,
      lastPrice: entryPrice,
      lastGainPct: 0,
      maxPrice: entryPrice,
      maxGainPct: 0,
      maxGainAt: now,
      gain1hPct: null,
      gain6hPct: null,
      gain24hPct: null,
      updatedAt: now,
      closed: false,
    });
    // Bound memory: drop the oldest closed calls once we exceed the cap.
    if (this.calls.size > 500) {
      for (const [id, c] of this.calls) {
        if (c.closed) this.calls.delete(id);
        if (this.calls.size <= 500) break;
      }
    }
  }

  start(): void {
    if (!config.PERFORMANCE_TRACKING) return;
    const everyMs = Math.max(1, config.PERF_SAMPLE_MINUTES) * 60_000;
    this.timer = setInterval(() => void this.sample(), everyMs);
    logger.info(
      { sampleMinutes: config.PERF_SAMPLE_MINUTES, trackHours: config.PERF_TRACK_HOURS },
      'performance tracker: following alert outcomes',
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async sample(): Promise<void> {
    const now = Date.now();
    const trackMs = config.PERF_TRACK_HOURS * 3_600_000;
    const open = [...this.calls.values()].filter((c) => !c.closed);
    for (const c of open) {
      try {
        await this.price.refreshNow(c.token);
      } catch {
        /* ignore transient fetch errors */
      }
      const p = this.price.priceOf(c.token);
      if (p > 0) {
        c.lastPrice = p;
        c.lastGainPct = gainPct(c.entryPrice, p);
        if (p > c.maxPrice) {
          c.maxPrice = p;
          c.maxGainPct = gainPct(c.entryPrice, p);
          c.maxGainAt = now;
        }
      }
      const age = now - c.entryAt;
      if (c.gain1hPct == null && age >= 3_600_000) c.gain1hPct = c.lastGainPct;
      if (c.gain6hPct == null && age >= 6 * 3_600_000) c.gain6hPct = c.lastGainPct;
      if (c.gain24hPct == null && age >= 24 * 3_600_000) c.gain24hPct = c.lastGainPct;
      if (age >= trackMs) c.closed = true;
      c.updatedAt = now;
    }
  }

  /** All tracked calls, best peak gain first. */
  list(): TrackedCall[] {
    return [...this.calls.values()].sort((a, b) => b.maxGainPct - a.maxGainPct);
  }

  /** Aggregate outcomes by the dimensions that matter for catching runners. */
  summary(): { total: number; winThresholdPct: number; byWalletCount: Bucket[]; byRepeat: Bucket[]; byKind: Bucket[] } {
    const all = [...this.calls.values()];
    const win = config.PERF_WIN_THRESHOLD_PCT;
    const multi = all.filter((c) => c.walletCount >= 2);
    const solo = all.filter((c) => c.walletCount < 2);
    const repeat = all.filter((c) => c.repeatCount >= 2);
    const single = all.filter((c) => c.repeatCount < 2);
    const kinds: SwarmKind[] = ['BUY', 'SELL', 'ROTATION', 'SOLO', 'ENTRY'];
    return {
      total: all.length,
      winThresholdPct: win,
      byWalletCount: [
        bucket('multi-wallet (2+)', multi, win),
        bucket('solo (1 wallet)', solo, win),
      ],
      byRepeat: [
        bucket('repeat (2+ alerts)', repeat, win),
        bucket('single alert', single, win),
      ],
      byKind: kinds.map((k) => bucket(k, all.filter((c) => c.kind === k), win)),
    };
  }
}

import { EventEmitter } from 'node:events';
import type {
  Alert,
  AlertRule,
  Swarm,
  SwapEvent,
  TrackedToken,
  TrackedWallet,
} from '../types.js';
import { SEED_TOKENS, SEED_WALLETS } from '../data/seed.js';
import { config } from '../config/env.js';

/** Fixed-size ring buffer of the most recent items. */
class Ring<T> {
  private buf: T[] = [];
  constructor(private readonly cap: number) {}
  push(item: T): void {
    this.buf.push(item);
    if (this.buf.length > this.cap) this.buf.shift();
  }
  /** Newest first. */
  recent(limit = this.cap): T[] {
    return this.buf.slice(-limit).reverse();
  }
  get size(): number {
    return this.buf.length;
  }
}

export interface StoreEvents {
  swap: (e: SwapEvent) => void;
  swarm: (s: Swarm) => void;
  alert: (a: Alert) => void;
  metrics: (m: LatencyMetrics) => void;
}

export interface LatencyMetrics {
  wsConnected: boolean;
  mode: 'live' | 'simulator';
  rpcLatencyMs: number | null;
  lastBlock: number;
  lastEventAt: number | null;
}

/**
 * Central in-memory state. Everything the bot needs to detect swarms and serve
 * the dashboard lives here so the hot path never touches the network or disk.
 * Postgres/Redis are optional write-behind sinks layered on top (see store/db).
 */
export class MemoryStore extends EventEmitter {
  readonly tokensByAddress = new Map<string, TrackedToken>();
  readonly tokensBySymbol = new Map<string, TrackedToken>();
  readonly wallets = new Map<string, TrackedWallet>();

  private readonly swaps = new Ring<SwapEvent>(2000);
  private readonly swarms = new Ring<Swarm>(500);
  private readonly alerts = new Ring<Alert>(500);
  readonly rules = new Map<string, AlertRule>();

  metrics: LatencyMetrics = {
    wsConnected: false,
    mode: config.chainMode,
    rpcLatencyMs: null,
    lastBlock: 0,
    lastEventAt: null,
  };

  /** Per-wallet, per-token running counts used by leaderboards. */
  readonly walletStats = new Map<
    string,
    { buys: number; sells: number; usdIn: number; usdOut: number }
  >();
  readonly tokenStats = new Map<
    string,
    { buys: number; sells: number; usdIn: number; usdOut: number; swarms: number }
  >();

  totals = { swaps: 0, swarms: 0, alerts: 0 };

  constructor() {
    super();
    this.setMaxListeners(0);
    for (const t of SEED_TOKENS) {
      this.tokensByAddress.set(t.address, t);
      this.tokensBySymbol.set(t.symbol, t);
    }
    for (const w of SEED_WALLETS) this.wallets.set(w.address, w);
  }

  isTracked(wallet: string): boolean {
    return this.wallets.has(wallet.toLowerCase());
  }

  recordSwap(e: SwapEvent): void {
    this.swaps.push(e);
    this.totals.swaps += 1;
    this.metrics.lastEventAt = e.timestamp;
    this.metrics.lastBlock = Math.max(this.metrics.lastBlock, e.blockNumber);

    const ws = this.walletStats.get(e.wallet) ?? {
      buys: 0,
      sells: 0,
      usdIn: 0,
      usdOut: 0,
    };
    const ts = this.tokenStats.get(e.token) ?? {
      buys: 0,
      sells: 0,
      usdIn: 0,
      usdOut: 0,
      swarms: 0,
    };
    if (e.direction === 'BUY') {
      ws.buys += 1;
      ws.usdIn += e.usdValue;
      ts.buys += 1;
      ts.usdIn += e.usdValue;
    } else {
      ws.sells += 1;
      ws.usdOut += e.usdValue;
      ts.sells += 1;
      ts.usdOut += e.usdValue;
    }
    this.walletStats.set(e.wallet, ws);
    this.tokenStats.set(e.token, ts);
    this.emit('swap', e);
  }

  recordSwarm(s: Swarm): void {
    this.swarms.push(s);
    this.totals.swarms += 1;
    const ts = this.tokenStats.get(s.token);
    if (ts) ts.swarms += 1;
    this.emit('swarm', s);
  }

  recordAlert(a: Alert): void {
    this.alerts.push(a);
    this.totals.alerts += 1;
    this.emit('alert', a);
  }

  updateMetrics(patch: Partial<LatencyMetrics>): void {
    this.metrics = { ...this.metrics, ...patch };
    this.emit('metrics', this.metrics);
  }

  recentSwaps(limit = 100): SwapEvent[] {
    return this.swaps.recent(limit);
  }
  recentSwarms(limit = 100): Swarm[] {
    return this.swarms.recent(limit);
  }
  recentAlerts(limit = 100): Alert[] {
    return this.alerts.recent(limit);
  }
}

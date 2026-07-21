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
  /** Coins (upper-case symbols) whose wallets are currently muted. Runtime-
   *  toggleable via the API; seeded from MUTE_WALLET_TOKENS. */
  readonly mutedTokens = new Set<string>();

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
    for (const sym of config.mutedWalletTokens) this.mutedTokens.add(sym.toUpperCase());
  }

  isTracked(wallet: string): boolean {
    return this.wallets.has(wallet.toLowerCase());
  }

  /**
   * A wallet is muted only when EVERY coin it is a tracked top-holder of is in
   * the muted set — so silencing "HMM" drops wallets sourced purely from HMM,
   * but keeps any wallet that also holds another tracked gem.
   */
  isWalletMuted(wallet: string): boolean {
    if (this.mutedTokens.size === 0) return false;
    const w = this.wallets.get(wallet.toLowerCase());
    if (!w || w.holdsTokens.length === 0) return false;
    return w.holdsTokens.every((c) => this.mutedTokens.has(c.toUpperCase()));
  }

  /**
   * Return the token for `address`, auto-registering a *discovered* token if we
   * have never seen it before. This is what lets the bot surface brand-new
   * coins that tracked wallets buy without them being pre-listed. Symbol/supply
   * are best-effort placeholders that chain metadata can later enrich.
   */
  ensureToken(address: string, symbol?: string): TrackedToken {
    const key = address.toLowerCase();
    const existing = this.tokensByAddress.get(key);
    if (existing) return existing;
    const token: TrackedToken = {
      address: key,
      symbol: symbol || `TKN-${key.slice(2, 6).toUpperCase()}`,
      name: symbol || `Discovered ${key.slice(0, 10)}`,
      totalSupply: 1_000_000_000, // estimated until enriched from chain
      stable: false,
      discovered: true,
      firstSeen: Date.now(),
    };
    this.tokensByAddress.set(key, token);
    this.tokensBySymbol.set(token.symbol, token);
    this.emit('token', token);
    return token;
  }

  /** Patch a discovered token's metadata once real values are known. */
  updateTokenMeta(address: string, meta: Partial<TrackedToken>): void {
    const key = address.toLowerCase();
    const token = this.tokensByAddress.get(key);
    if (!token) return;
    const oldSymbol = token.symbol;
    Object.assign(token, meta);
    if (meta.symbol && meta.symbol !== oldSymbol) {
      this.tokensBySymbol.delete(oldSymbol);
      this.tokensBySymbol.set(token.symbol, token);
    }
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
    // Bound per-token stats on a long-running process (many discovered tokens).
    while (this.tokenStats.size > 10_000) {
      const oldest = this.tokenStats.keys().next().value;
      if (oldest === undefined) break;
      this.tokenStats.delete(oldest);
    }
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

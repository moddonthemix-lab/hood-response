import WebSocket from 'ws';
import { config } from '../config/env.js';
import { logger } from '../logger.js';
import type { MemoryStore } from '../store/memory.js';
import type { SwapEvent, TrackedWallet } from '../types.js';
import { PriceOracle } from './price.js';
import {
  TRANSFER_TOPIC,
  decodeTransfer,
  directionFor,
  toHuman,
  type EthLog,
} from './decoder.js';

export type SwapHandler = (e: SwapEvent) => void;

export interface ChainListener {
  start(): void;
  stop(): void;
}

/**
 * Live listener: subscribes to ERC-20 Transfer logs for the tracked tokens over
 * a JSON-RPC WebSocket, decodes them into BUY/SELL swaps for tracked wallets,
 * and auto-reconnects with exponential backoff. New heads drive block/latency
 * metrics.
 */
export class LiveChainListener implements ChainListener {
  private ws: WebSocket | null = null;
  private stopped = false;
  private backoffMs = 1000;
  private pingTimer: NodeJS.Timeout | null = null;
  private latencyTimer: NodeJS.Timeout | null = null;
  private nextId = 1;
  private readonly pendingLatency = new Map<number, number>();

  constructor(
    private readonly store: MemoryStore,
    private readonly price: PriceOracle,
    private readonly onSwap: SwapHandler,
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.latencyTimer) clearInterval(this.latencyTimer);
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    if (this.stopped) return;
    const url = config.CHAIN_WS_URL;
    logger.info({ url }, 'connecting to Robinhood Chain RPC');
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      this.backoffMs = 1000;
      this.store.updateMetrics({ wsConnected: true });
      logger.info('chain websocket connected');
      // Subscribe to Transfer logs for tracked tokens.
      const addresses = [...this.store.tokensByAddress.keys()];
      this.send('eth_subscribe', [
        'logs',
        { address: addresses, topics: [TRANSFER_TOPIC] },
      ]);
      this.send('eth_subscribe', ['newHeads']);
      this.startLatencyProbe();
    });

    ws.on('message', (data) => this.onMessage(data.toString()));

    ws.on('close', () => {
      this.store.updateMetrics({ wsConnected: false });
      if (this.latencyTimer) clearInterval(this.latencyTimer);
      if (!this.stopped) this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      logger.warn({ err: err.message }, 'chain websocket error');
      ws.close();
    });
  }

  private scheduleReconnect(): void {
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    logger.warn({ delay }, 'reconnecting to chain RPC');
    setTimeout(() => this.connect(), delay);
  }

  private send(method: string, params: unknown[]): number {
    const id = this.nextId++;
    this.ws?.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    return id;
  }

  private startLatencyProbe(): void {
    this.latencyTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      const id = this.send('eth_blockNumber', []);
      this.pendingLatency.set(id, Date.now());
    }, 5000);
  }

  private onMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Latency probe reply.
    if (msg.id && this.pendingLatency.has(msg.id)) {
      const sent = this.pendingLatency.get(msg.id)!;
      this.pendingLatency.delete(msg.id);
      this.store.updateMetrics({ rpcLatencyMs: Date.now() - sent });
      return;
    }

    if (msg.method !== 'eth_subscription') return;
    const result = msg.params?.result;
    if (!result) return;

    // newHeads carry { number }.
    if (typeof result.number === 'string' && !result.topics) {
      this.store.updateMetrics({ lastBlock: Number(BigInt(result.number)) });
      return;
    }

    this.handleLog(result as EthLog);
  }

  private handleLog(log: EthLog): void {
    const transfer = decodeTransfer(log);
    if (!transfer) return;
    const token = this.store.tokensByAddress.get(transfer.token);
    if (!token) return;
    const match = directionFor(transfer, (a) => this.store.isTracked(a));
    if (!match) return;

    const amount = toHuman(transfer.rawValue, 18);
    const swap: SwapEvent = {
      txHash: transfer.txHash,
      wallet: match.wallet,
      token: transfer.token,
      tokenSymbol: token.symbol,
      direction: match.direction,
      amount,
      usdValue: this.price.usdValue(transfer.token, amount),
      blockNumber: transfer.blockNumber || this.store.metrics.lastBlock,
      timestamp: Date.now(),
    };
    this.onSwap(swap);
  }
}

/**
 * Simulator: replays synthetic activity against the seeded wallets so the full
 * pipeline runs with zero external dependencies. Every tick it either emits
 * scattered background swaps or fires a *coordinated* swarm — several wallets
 * hitting the same token inside the alert window — so alerts actually trigger.
 */
export class SimulatorChainListener implements ChainListener {
  private timer: NodeJS.Timeout | null = null;
  private block = 21_000_000;
  private readonly walletList: TrackedWallet[];

  constructor(
    private readonly store: MemoryStore,
    private readonly price: PriceOracle,
    private readonly onSwap: SwapHandler,
  ) {
    this.walletList = [...store.wallets.values()];
  }

  start(): void {
    this.store.updateMetrics({ wsConnected: true, mode: 'simulator' });
    logger.info('simulator listener started (no CHAIN_WS_URL set)');
    this.timer = setInterval(() => this.tick(), config.SIM_TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.store.updateMetrics({ wsConnected: false });
  }

  private pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)]!;
  }

  private emitSwap(wallet: TrackedWallet, tokenSymbol: string, direction: 'BUY' | 'SELL'): void {
    const token = this.store.tokensBySymbol.get(tokenSymbol);
    if (!token) return;
    const amount = Math.floor(50_000 + Math.random() * 4_000_000);
    this.block += Math.random() < 0.3 ? 1 : 0;
    const swap: SwapEvent = {
      txHash: '0x' + Math.random().toString(16).slice(2).padEnd(64, '0').slice(0, 64),
      wallet: wallet.address,
      token: token.address,
      tokenSymbol,
      direction,
      amount,
      usdValue: this.price.usdValue(token.address, amount),
      blockNumber: this.block,
      timestamp: Date.now(),
    };
    this.store.updateMetrics({
      lastBlock: this.block,
      rpcLatencyMs: Math.round(20 + Math.random() * 60),
    });
    this.onSwap(swap);
  }

  private tick(): void {
    if (Math.random() < config.SIM_SWARM_CHANCE) {
      // Coordinated swarm: prefer wallets that actually hold the token.
      const token = this.pick([...this.store.tokensBySymbol.keys()]);
      const direction: 'BUY' | 'SELL' = Math.random() < 0.65 ? 'BUY' : 'SELL';
      const holders = this.walletList.filter((w) => w.holdsTokens.includes(token));
      const pool = holders.length >= 3 ? holders : this.walletList;
      const count = 3 + Math.floor(Math.random() * 4);
      const chosen = new Set<TrackedWallet>();
      while (chosen.size < Math.min(count, pool.length)) chosen.add(this.pick(pool));
      // Fire them within a fraction of the alert window so they aggregate.
      let delay = 0;
      for (const w of chosen) {
        setTimeout(() => this.emitSwap(w, token, direction), delay);
        delay += Math.floor(Math.random() * 800);
      }
    } else {
      // Background noise: a single random swap.
      const w = this.pick(this.walletList);
      const token = w.holdsTokens.length
        ? this.pick(w.holdsTokens)
        : this.pick([...this.store.tokensBySymbol.keys()]);
      this.emitSwap(w, token, Math.random() < 0.5 ? 'BUY' : 'SELL');
    }
  }
}

export function createListener(
  store: MemoryStore,
  price: PriceOracle,
  onSwap: SwapHandler,
): ChainListener {
  return config.chainMode === 'live'
    ? new LiveChainListener(store, price, onSwap)
    : new SimulatorChainListener(store, price, onSwap);
}

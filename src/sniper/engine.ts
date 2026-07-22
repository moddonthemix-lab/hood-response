import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from '../config/env.js';
import { logger } from '../logger.js';
import type { PriceOracle } from '../chain/price.js';
import type { Swarm } from '../types.js';
import { SwapExecutor } from './executor.js';

/** Absolute floor on any single buy, regardless of the configured amount. */
export const MIN_BUY_ETH = 0.0005;
const SAMPLE_MS = 60_000;

export interface Position {
  id: string;
  token: string;
  tokenSymbol: string;
  kind: string;
  conviction: number;
  ethIn: number;
  entryPriceUsd: number;
  entryMarketCap: number;
  tokensReceived: number;
  buyTx: string;
  openedAt: number;
  lastPriceUsd: number;
  updatedAt: number;
  status: 'open' | 'closed';
  closedAt?: number;
  sellTx?: string;
  exitPriceUsd?: number;
  closeReason?: 'take-profit' | 'manual';
}

/** Runtime-adjustable knobs (seeded from env, editable via the API). */
export interface SniperSettings {
  enabled: boolean;
  minConviction: number;
  maxConviction: number;
  buyEth: number;
  takeProfitPct: number;
}

const priceRatio = (p: Position, price: number): number =>
  p.entryPriceUsd > 0 ? price / p.entryPriceUsd : 1;

/** Live-computed view of a position for the API/dashboard. */
function view(p: Position) {
  const ref = p.status === 'closed' ? (p.exitPriceUsd ?? p.lastPriceUsd) : p.lastPriceUsd;
  const ratio = priceRatio(p, ref);
  const valueEth = p.ethIn * ratio;
  return {
    ...p,
    valueEth: Math.round(valueEth * 1e6) / 1e6,
    pnlEth: Math.round((valueEth - p.ethIn) * 1e6) / 1e6,
    pnlPct: Math.round((ratio - 1) * 1000) / 10,
  };
}

/**
 * Auto-buys qualifying alerts with a server hot wallet and manages the open
 * positions (live value, PnL, take-profit auto-sell). Off by default; when on
 * it places REAL swaps through the SwapExecutor. All spending is bounded by the
 * per-trade and daily caps and the absolute MIN_BUY_ETH floor.
 */
export class SniperEngine {
  private readonly positions = new Map<string, Position>();
  private readonly buys: { at: number; eth: number }[] = [];
  /** Recent buy/skip decisions with reasons — powers the "why didn't it buy?"
   *  list on the dashboard. Newest is last. */
  private readonly decisions: {
    at: number;
    tokenSymbol: string;
    kind: string;
    conviction: number;
    action: 'bought' | 'skipped';
    reason: string;
  }[] = [];
  private timer: NodeJS.Timeout | null = null;
  private warnedUnconfigured = false;
  readonly executor: SwapExecutor;

  settings: SniperSettings = {
    enabled: config.SNIPER_ENABLED,
    minConviction: config.SNIPER_MIN_CONVICTION,
    maxConviction: config.SNIPER_MAX_CONVICTION,
    buyEth: config.SNIPER_BUY_ETH,
    takeProfitPct: config.SNIPER_TAKE_PROFIT_PCT,
  };

  constructor(
    private readonly price: PriceOracle,
    executor?: SwapExecutor,
  ) {
    this.executor = executor ?? new SwapExecutor();
  }

  start(): void {
    this.timer = setInterval(() => void this.sample(), SAMPLE_MS);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Effective per-trade size after the floor and per-trade ceiling. */
  private sizeEth(): number {
    return Math.min(config.SNIPER_MAX_ETH_PER_TRADE, Math.max(MIN_BUY_ETH, this.settings.buyEth));
  }

  private spentLast24h(now: number): number {
    const cut = now - 86_400_000;
    return this.buys.filter((b) => b.at >= cut).reduce((s, b) => s + b.eth, 0);
  }

  private holdsOpen(token: string): boolean {
    for (const p of this.positions.values()) if (p.status === 'open' && p.token === token) return true;
    return false;
  }

  /** Record why the sniper did or didn't act on an alert (newest kept last). */
  private decide(swarm: Swarm, action: 'bought' | 'skipped', reason: string): void {
    this.decisions.push({
      at: Date.now(),
      tokenSymbol: swarm.tokenSymbol,
      kind: swarm.kind,
      conviction: swarm.conviction,
      action,
      reason,
    });
    if (this.decisions.length > 30) this.decisions.shift();
    if (action === 'skipped') {
      logger.info({ token: swarm.tokenSymbol, kind: swarm.kind, conviction: swarm.conviction, reason }, 'sniper: skipped alert');
    }
  }

  /** Alert hook: decide whether to snipe, and buy if so. */
  async onAlert(swarm: Swarm): Promise<void> {
    if (!this.settings.enabled) return this.decide(swarm, 'skipped', 'sniper is OFF');
    if (!config.sniperKinds.has(swarm.kind)) return this.decide(swarm, 'skipped', `kind ${swarm.kind} not in buy list`);
    if (swarm.conviction < this.settings.minConviction || swarm.conviction > this.settings.maxConviction)
      return this.decide(swarm, 'skipped', `conviction ${swarm.conviction} outside ${this.settings.minConviction}-${this.settings.maxConviction}`);
    if (this.holdsOpen(swarm.token)) return this.decide(swarm, 'skipped', 'already holding this token');

    const entryPrice = swarm.priceUsd ?? 0;
    if (!swarm.priceLive || !(entryPrice > 0)) return this.decide(swarm, 'skipped', 'no live price');

    if (!this.executor.ready) {
      if (!this.warnedUnconfigured) {
        this.warnedUnconfigured = true;
        logger.warn('sniper is ON but the wallet/router/WETH are not configured — no buys will run');
      }
      return this.decide(swarm, 'skipped', 'wallet not connected');
    }

    const now = Date.now();
    const size = this.sizeEth();
    if (this.spentLast24h(now) + size > config.SNIPER_DAILY_CAP_ETH) {
      return this.decide(swarm, 'skipped', 'daily spend cap reached');
    }

    try {
      const res = await this.executor.buy(swarm.token, size, this.price.pairIdOf(swarm.token));
      this.buys.push({ at: now, eth: res.ethSpent });
      const pos: Position = {
        id: randomUUID(),
        token: swarm.token,
        tokenSymbol: swarm.tokenSymbol,
        kind: swarm.kind,
        conviction: swarm.conviction,
        ethIn: res.ethSpent,
        entryPriceUsd: entryPrice,
        entryMarketCap: swarm.marketCap,
        tokensReceived: res.tokensReceived,
        buyTx: res.txHash,
        openedAt: now,
        lastPriceUsd: entryPrice,
        updatedAt: now,
        status: 'open',
      };
      this.positions.set(pos.id, pos);
      this.decide(swarm, 'bought', `bought ${size} Ξ · tx ${res.txHash.slice(0, 10)}`);
      logger.info(
        { token: swarm.tokenSymbol, eth: size, conviction: swarm.conviction, tx: res.txHash },
        'sniper: opened position',
      );
      void this.persist();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.decide(swarm, 'skipped', `buy failed: ${msg.slice(0, 80)}`);
      logger.error({ token: swarm.tokenSymbol, err: String(err) }, 'sniper: buy failed');
    }
  }

  /** Periodic: refresh open-position prices and fire take-profit sells. */
  private async sample(): Promise<void> {
    const now = Date.now();
    const open = [...this.positions.values()].filter((p) => p.status === 'open');
    for (const p of open) {
      try {
        await this.price.refreshNow(p.token);
      } catch {
        /* transient */
      }
      const px = this.price.isLive(p.token) ? this.price.priceOf(p.token) : 0;
      if (px > 0) {
        p.lastPriceUsd = px;
        p.updatedAt = now;
        const tp = this.settings.takeProfitPct;
        if (tp > 0 && (px / p.entryPriceUsd - 1) * 100 >= tp) {
          await this.takeProfit(p);
        }
      }
    }
    void this.persist();
  }

  private async closePosition(p: Position, reason: 'take-profit' | 'manual'): Promise<void> {
    const res = await this.executor.sell(p.token, this.price.pairIdOf(p.token));
    p.status = 'closed';
    p.closedAt = Date.now();
    p.sellTx = res.txHash;
    p.exitPriceUsd = p.lastPriceUsd;
    p.closeReason = reason;
    logger.info({ token: p.tokenSymbol, tx: res.txHash, ethOut: res.ethReceived, reason }, 'sniper: position sold');
    void this.persist();
  }

  private async takeProfit(p: Position): Promise<void> {
    if (p.status !== 'open') return;
    try {
      await this.closePosition(p, 'take-profit');
    } catch (err) {
      logger.error({ token: p.tokenSymbol, err: String(err) }, 'sniper: take-profit sell failed');
    }
  }

  /** Manual "sell now" for an open position (before take-profit is hit). */
  async sellNow(id: string): Promise<Position> {
    const p = this.positions.get(id);
    if (!p || p.status !== 'open') throw new Error('position not open');
    await this.closePosition(p, 'manual');
    return p;
  }

  /** Stop tracking a position WITHOUT selling — for clearing a bad/duplicate
   *  import (e.g. one recorded before a metadata fix). The wallet's tokens are
   *  untouched; re-import to pick it back up correctly. */
  untrack(id: string): boolean {
    const ok = this.positions.delete(id);
    if (ok) void this.persist();
    return ok;
  }

  /** Set the hot-wallet key at runtime (from the dashboard). Returns the derived
   *  address. Never persisted; lives in memory until restart. */
  setPrivateKey(pk: string): string {
    return this.executor.setPrivateKey(pk);
  }

  /** Manual one-off buy to validate the router before trusting auto-fire. Still
   *  bounded by the min-buy floor and per-trade cap. */
  async testBuy(token: string, ethAmount: number): Promise<Position> {
    if (!this.executor.ready) throw new Error('wallet not configured');
    const size = Math.min(config.SNIPER_MAX_ETH_PER_TRADE, Math.max(MIN_BUY_ETH, ethAmount));
    const now = Date.now();
    const px = this.price.isLive(token) ? this.price.priceOf(token) : 0;
    const res = await this.executor.buy(token, size, this.price.pairIdOf(token));
    this.buys.push({ at: now, eth: res.ethSpent });
    const pos: Position = {
      id: randomUUID(),
      token,
      tokenSymbol: 'TEST-' + token.slice(2, 8).toUpperCase(),
      kind: 'TEST',
      conviction: 0,
      ethIn: res.ethSpent,
      entryPriceUsd: px > 0 ? px : 0,
      entryMarketCap: 0,
      tokensReceived: res.tokensReceived,
      buyTx: res.txHash,
      openedAt: now,
      lastPriceUsd: px > 0 ? px : 0,
      updatedAt: now,
      status: 'open',
    };
    this.positions.set(pos.id, pos);
    void this.persist();
    return pos;
  }

  /** Recover/import a holding the wallet already has (e.g. a position lost to a
   *  redeploy, or a manual buy) so it shows up and can be sold / TP-managed.
   *  Pulls the real symbol/supply from the token contract and forces a live
   *  price fetch — without a real entryPriceUsd, PnL/take-profit can't work.
   *  ethIn is set to the current sellable value, so PnL tracks from import. */
  async importPosition(token: string): Promise<Position> {
    if (!this.executor.ready) throw new Error('wallet not connected');
    if (this.holdsOpen(token)) throw new Error('already tracking this token');
    const [{ tokens, ethOut }, meta] = await Promise.all([
      this.executor.valueInEth(token, this.price.pairIdOf(token)),
      this.executor.tokenMeta(token).catch(() => ({ symbol: token.slice(0, 8), totalSupply: 0 })),
    ]);
    // Force a fresh price fetch — this token may never have been priced before
    // (bought directly via the sniper, bypassing normal discovery).
    await this.price.refreshNow(token).catch(() => undefined);
    const px = this.price.isLive(token) ? this.price.priceOf(token) : 0;
    if (px <= 0) {
      throw new Error('no live price available for this token yet — try again in a few seconds');
    }
    const now = Date.now();
    const pos: Position = {
      id: randomUUID(),
      token,
      tokenSymbol: meta.symbol,
      kind: 'IMPORT',
      conviction: 0,
      ethIn: Math.round(ethOut * 1e8) / 1e8,
      entryPriceUsd: px,
      entryMarketCap: Math.round(px * meta.totalSupply),
      tokensReceived: tokens,
      buyTx: 'imported',
      openedAt: now,
      lastPriceUsd: px,
      updatedAt: now,
      status: 'open',
    };
    this.positions.set(pos.id, pos);
    void this.persist();
    logger.info({ token, tokens, ethOut }, 'sniper: imported position');
    return pos;
  }

  updateSettings(patch: Partial<SniperSettings>): SniperSettings {
    if (typeof patch.enabled === 'boolean') this.settings.enabled = patch.enabled;
    if (typeof patch.minConviction === 'number') this.settings.minConviction = clamp(patch.minConviction, 0, 100);
    if (typeof patch.maxConviction === 'number') this.settings.maxConviction = clamp(patch.maxConviction, 0, 100);
    if (typeof patch.buyEth === 'number') this.settings.buyEth = Math.max(MIN_BUY_ETH, patch.buyEth);
    if (typeof patch.takeProfitPct === 'number') this.settings.takeProfitPct = Math.max(0, patch.takeProfitPct);
    logger.info({ settings: this.settings }, 'sniper: settings updated');
    return this.settings;
  }

  /** Full snapshot for the API/dashboard. Refreshes open-position prices from
   *  the oracle first so PnL is as live as the price feed on every poll (the
   *  oracle caches, so this only hits the network when a price is stale). */
  async snapshot() {
    const openTokens = [...new Set(
      [...this.positions.values()].filter((p) => p.status === 'open').map((p) => p.token),
    )];
    await Promise.all(openTokens.map((t) => this.price.refreshNow(t).catch(() => undefined)));
    const now = Date.now();
    for (const p of this.positions.values()) {
      if (p.status !== 'open') continue;
      const px = this.price.isLive(p.token) ? this.price.priceOf(p.token) : 0;
      if (px > 0) {
        p.lastPriceUsd = px;
        p.updatedAt = now;
      }
    }
    const positions = [...this.positions.values()]
      .map(view)
      .sort((a, b) => (b.status === 'open' ? 1 : 0) - (a.status === 'open' ? 1 : 0) || b.openedAt - a.openedAt);
    const open = positions.filter((p) => p.status === 'open');
    const closed = positions.filter((p) => p.status === 'closed');
    const unrealizedPnlEth = open.reduce((s, p) => s + p.pnlEth, 0);
    const realizedPnlEth = closed.reduce((s, p) => s + p.pnlEth, 0);
    const investedEth = open.reduce((s, p) => s + p.ethIn, 0);
    const openValueEth = open.reduce((s, p) => s + p.valueEth, 0);
    const walletEth = await this.executor.balanceEth();
    return {
      configured: this.executor.ready,
      wallet: { address: this.executor.address(), balanceEth: walletEth },
      // Full account picture: free ETH in the wallet + value of open positions.
      account: {
        walletEth: walletEth == null ? null : round6(walletEth),
        positionsEth: round6(openValueEth),
        totalEth: walletEth == null ? null : round6(walletEth + openValueEth),
      },
      settings: this.settings,
      minBuyEth: MIN_BUY_ETH,
      caps: { perTradeEth: config.SNIPER_MAX_ETH_PER_TRADE, dailyEth: config.SNIPER_DAILY_CAP_ETH, spentTodayEth: round6(this.spentLast24h(Date.now())) },
      pnl: {
        investedEth: round6(investedEth),
        openValueEth: round6(openValueEth),
        unrealizedPnlEth: round6(unrealizedPnlEth),
        realizedPnlEth: round6(realizedPnlEth),
        totalPnlEth: round6(unrealizedPnlEth + realizedPnlEth),
      },
      decisions: [...this.decisions].reverse(),
      positions,
    };
  }

  // ── Persistence (survive redeploys via SNIPER_STORE_PATH) ─────────────────────
  async load(): Promise<void> {
    if (!config.SNIPER_STORE_PATH) return;
    try {
      const raw = await readFile(config.SNIPER_STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      const arr = Array.isArray(parsed) ? (parsed as Position[]) : [];
      for (const p of arr) if (p && p.id) this.positions.set(p.id, p);
      logger.info({ loaded: this.positions.size }, 'sniper: restored positions');
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') logger.warn({ err: String(err) }, 'sniper: could not load positions');
    }
  }
  private persisting = false;
  private async persist(): Promise<void> {
    if (this.persisting) return;
    await this.flush();
  }
  /** Write positions to disk now (used on each change and on graceful shutdown
   *  so the pre-redeploy state is captured). */
  async flush(): Promise<void> {
    if (!config.SNIPER_STORE_PATH) return;
    this.persisting = true;
    try {
      const path = config.SNIPER_STORE_PATH;
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify([...this.positions.values()]));
      await rename(tmp, path);
    } catch (err) {
      logger.warn({ err: String(err) }, 'sniper: could not save positions');
    } finally {
      this.persisting = false;
    }
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

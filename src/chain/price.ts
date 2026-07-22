import type { MomentumReport, TrackedToken } from '../types.js';
import type { MemoryStore } from '../store/memory.js';
import { config } from '../config/env.js';
import { logger } from '../logger.js';
import { dexScreenerUrl } from '../links.js';
import { computeMomentum } from './momentum.js';

interface LivePrice {
  priceUsd: number;
  /** Price in the pair's quote currency (almost always WETH here) — lets us
   *  derive an ETH/USD rate from ANY live pair (priceUsd / priceNative), since
   *  DexScreener won't return a direct listing for WETH itself (it's the quote
   *  side of virtually every pair, never the base). */
  priceNative: number | null;
  marketCap: number;
  liquidityUsd: number | null;
  pairCreatedAt: number | null;
  volume24: number | null;
  priceChangeH1: number | null;
  priceChangeH24: number | null;
  buys24: number | null;
  sells24: number | null;
  dexId: string | null;
  pairAddress: string;
  chainId: string;
  fetchedAt: number;
}

interface DexPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; symbol?: string };
  priceUsd?: string;
  priceNative?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  pairCreatedAt?: number;
  volume?: { h24?: number; h6?: number; h1?: number };
  priceChange?: { h24?: number; h6?: number; h1?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
}

const TTL_MS = 60_000;
// Tokens re-priced per refresh tick. Each is a separate request because the
// multi-token endpoint caps at 30 pairs *total*, which starves busy tokens.
const MAX_PER_TICK = 12;
// Bound the caches on a long-running process (many discovered tokens).
const MAX_CACHE = 5_000;
const LIVE_STALE_MS = 30 * 60_000;

/** Evict oldest-inserted entries until the map is under `max`. */
function capMap<T>(map: Map<string, T>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/**
 * USD price / market-cap oracle.
 *
 * When `DEXSCREENER_CHAIN` is configured, real prices, market caps and pair
 * links are pulled from DexScreener's public API (cached, refreshed in the
 * background, filtered to the configured chain so we never pick a same-address
 * token on the wrong chain). Anything not found on DexScreener — and everything
 * when no chain is configured — falls back to a deterministic synthetic price,
 * so the pipeline always has a number and never blocks on the network.
 */
export class PriceOracle {
  private readonly synthetic = new Map<string, number>();
  private readonly live = new Map<string, LivePrice>();
  private readonly queue = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  /** Highest market cap seen for each token since this process started
   *  tracking it (not a true lifetime ATH — DexScreener doesn't expose one —
   *  but the best signal available without a paid data source). */
  private readonly athMarketCap = new Map<string, number>();

  constructor(
    tokens: readonly TrackedToken[],
    private readonly store?: MemoryStore,
  ) {
    for (const t of tokens) this.synthetic.set(t.address, this.derive(t.address));
  }

  /** Real prices require a chain slug so we can select the correct pair. */
  get liveEnabled(): boolean {
    return config.DEXSCREENER_CHAIN.length > 0;
  }

  private derive(address: string): number {
    let h = 0;
    for (let i = 2; i < address.length; i += 4) {
      h = (h * 31 + parseInt(address.slice(i, i + 4), 16)) % 1_000_000;
    }
    return 0.00002 + (h / 1_000_000) * 0.02;
  }

  private syntheticPrice(address: string): number {
    let p = this.synthetic.get(address);
    if (p === undefined) {
      p = this.derive(address);
      this.synthetic.set(address, p);
      if (this.synthetic.size > MAX_CACHE) capMap(this.synthetic, MAX_CACHE);
    }
    return p;
  }

  private fresh(address: string): LivePrice | null {
    const l = this.live.get(address.toLowerCase());
    if (l && Date.now() - l.fetchedAt < TTL_MS) return l;
    return null;
  }

  private maybeEnqueue(address: string): void {
    if (!this.liveEnabled) return;
    if (this.fresh(address)) return;
    this.queue.add(address.toLowerCase());
  }

  priceOf(tokenAddress: string): number {
    const key = tokenAddress.toLowerCase();
    const live = this.fresh(key);
    this.maybeEnqueue(key);
    return live ? live.priceUsd : this.syntheticPrice(key);
  }

  usdValue(tokenAddress: string, humanAmount: number): number {
    return humanAmount * this.priceOf(tokenAddress);
  }

  marketCap(token: TrackedToken): number {
    const live = this.fresh(token.address);
    this.maybeEnqueue(token.address);
    if (live && live.marketCap > 0) return live.marketCap;
    return this.priceOf(token.address) * token.totalSupply;
  }

  /** True when the token currently has a live DexScreener price. */
  isLive(tokenAddress: string): boolean {
    return this.fresh(tokenAddress) !== null;
  }

  /** Live DEX liquidity (USD) for the token, or null if unknown. */
  liquidityOf(tokenAddress: string): number | null {
    return this.fresh(tokenAddress)?.liquidityUsd ?? null;
  }

  /** Pair creation time (unix ms) for the token, or null if unknown. */
  pairCreatedAt(tokenAddress: string): number | null {
    return this.fresh(tokenAddress)?.pairCreatedAt ?? null;
  }

  /** Highest market cap seen for this token since tracking began, or null if
   *  it has never had a live price. Always >= the current market cap. */
  athMarketCapOf(tokenAddress: string): number | null {
    return this.athMarketCap.get(tokenAddress.toLowerCase()) ?? null;
  }

  /** Volume/momentum confirmation for the token, or null if no live pair. */
  momentumOf(tokenAddress: string): MomentumReport | null {
    const l = this.fresh(tokenAddress);
    if (!l) return null;
    return computeMomentum({
      volumeUsd: l.volume24,
      priceChange1h: l.priceChangeH1,
      priceChange24h: l.priceChangeH24,
      buys: l.buys24,
      sells: l.sells24,
    });
  }

  /** DEX id (e.g. "uniswap") for the token's best pair, or null. */
  dexIdOf(tokenAddress: string): string | null {
    return this.fresh(tokenAddress)?.dexId ?? null;
  }

  /**
   * Native-token (ETH/WETH) USD price, derived from ANY currently-live pair as
   * priceUsd / priceNative — since a token's own priceUsd is already priced
   * against its quote currency (WETH here), that ratio IS the ETH/USD rate.
   * DexScreener never returns a direct "WETH" listing (WETH is the quote side
   * of virtually every pair, never the base), so this is the reliable source.
   * Returns null only if no live pair has been fetched yet.
   */
  ethUsdPrice(): number | null {
    let best: { rate: number; fetchedAt: number } | null = null;
    for (const l of this.live.values()) {
      if (!l.priceNative || l.priceNative <= 0) continue;
      const rate = l.priceUsd / l.priceNative;
      if (!best || l.fetchedAt > best.fetchedAt) best = { rate, fetchedAt: l.fetchedAt };
    }
    return best?.rate ?? null;
  }

  /** DexScreener pair identifier for the token's best pair, or null. On
   *  Uniswap v4 chains this is the 32-byte POOL ID — the sniper uses it to
   *  resolve the exact on-chain PoolKey instead of guessing pool params. */
  pairIdOf(tokenAddress: string): string | null {
    return this.fresh(tokenAddress)?.pairAddress || null;
  }

  /**
   * Fetch this token's price/market cap right now if we don't already have a
   * fresh value. Used at alert time so the market cap in a notification is the
   * real one, not the synthetic placeholder (important for just-discovered
   * tokens the background refresher hasn't reached yet).
   */
  async refreshNow(tokenAddress: string): Promise<void> {
    if (!this.liveEnabled) return;
    const key = tokenAddress.toLowerCase();
    if (this.fresh(key)) return;
    await this.fetchOne(key);
  }

  /** Best DexScreener link: the precise pair page when known, else token search. */
  dexUrl(tokenAddress: string): string {
    const live = this.fresh(tokenAddress);
    if (live?.pairAddress) {
      return `https://dexscreener.com/${live.chainId}/${live.pairAddress}`;
    }
    return dexScreenerUrl(tokenAddress);
  }

  // ── Background refresh ────────────────────────────────────────────────────
  start(): void {
    if (!this.liveEnabled) {
      logger.info('price oracle: synthetic mode (set DEXSCREENER_CHAIN for live prices)');
      return;
    }
    logger.info({ chain: config.DEXSCREENER_CHAIN }, 'price oracle: live DexScreener prices');
    this.timer = setInterval(() => void this.refresh(), config.PRICE_REFRESH_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async refresh(): Promise<void> {
    // Re-price known tokens that have gone stale, plus anything newly queued.
    if (this.store) {
      for (const addr of this.store.tokensByAddress.keys()) this.maybeEnqueue(addr);
    }
    // Evict stale/overflowing live prices.
    const staleBefore = Date.now() - LIVE_STALE_MS;
    for (const [addr, l] of this.live) if (l.fetchedAt < staleBefore) this.live.delete(addr);
    capMap(this.live, MAX_CACHE);

    if (this.queue.size === 0) return;
    const batch = [...this.queue].slice(0, MAX_PER_TICK);
    for (const a of batch) this.queue.delete(a);
    await Promise.all(batch.map((a) => this.fetchOne(a)));
  }

  private async fetchOne(address: string): Promise<void> {
    const chain = config.DEXSCREENER_CHAIN.toLowerCase();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
        signal: ctrl.signal,
      });
      if (!res.ok) return;
      const json = (await res.json()) as { pairs?: DexPair[] };

      // Highest-liquidity pair on the configured chain where this is the base token.
      let best: DexPair | null = null;
      for (const p of json.pairs ?? []) {
        if ((p.chainId ?? '').toLowerCase() !== chain) continue;
        if (p.baseToken?.address?.toLowerCase() !== address) continue;
        if (!best || (p.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0)) best = p;
      }
      if (!best) return;

      const priceUsd = Number(best.priceUsd);
      if (!Number.isFinite(priceUsd) || priceUsd <= 0) return;
      const priceNative = Number(best.priceNative);
      const marketCap = best.marketCap ?? best.fdv ?? 0;
      if (marketCap > (this.athMarketCap.get(address) ?? 0)) {
        this.athMarketCap.set(address, marketCap);
        capMap(this.athMarketCap, MAX_CACHE);
      }
      this.live.set(address, {
        priceUsd,
        priceNative: Number.isFinite(priceNative) && priceNative > 0 ? priceNative : null,
        marketCap,
        liquidityUsd: best.liquidity?.usd ?? null,
        pairCreatedAt: best.pairCreatedAt ?? null,
        volume24: best.volume?.h24 ?? null,
        priceChangeH1: best.priceChange?.h1 ?? null,
        priceChangeH24: best.priceChange?.h24 ?? null,
        buys24: best.txns?.h24?.buys ?? null,
        sells24: best.txns?.h24?.sells ?? null,
        dexId: best.dexId ?? null,
        pairAddress: best.pairAddress ?? '',
        chainId: best.chainId ?? config.DEXSCREENER_CHAIN,
        fetchedAt: Date.now(),
      });
      // Enrich a discovered token's placeholder symbol from the real pair.
      const sym = best.baseToken?.symbol;
      const tok = this.store?.tokensByAddress.get(address);
      if (sym && tok?.discovered && tok.symbol.startsWith('TKN-')) {
        this.store?.updateTokenMeta(address, { symbol: sym, name: sym });
      }
    } catch (err) {
      logger.debug({ err: String(err) }, 'dexscreener price fetch failed');
    } finally {
      clearTimeout(t);
    }
  }
}

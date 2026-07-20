import type { TrackedToken } from '../types.js';

/**
 * Lightweight USD price oracle.
 *
 * Robinhood Chain does not (yet) expose a public price feed in this build, so
 * prices are derived deterministically from the token address to give the rest
 * of the pipeline realistic, stable notionals. Swap in a real DexScreener /
 * on-chain TWAP source here without touching any callers.
 */
export class PriceOracle {
  private readonly prices = new Map<string, number>();

  constructor(tokens: readonly TrackedToken[]) {
    for (const t of tokens) this.prices.set(t.address, this.derive(t.address));
  }

  private derive(address: string): number {
    // Stable pseudo-random price in [0.00002, 0.02] from the address bytes.
    let h = 0;
    for (let i = 2; i < address.length; i += 4) {
      h = (h * 31 + parseInt(address.slice(i, i + 4), 16)) % 1_000_000;
    }
    return 0.00002 + (h / 1_000_000) * 0.02;
  }

  priceOf(tokenAddress: string): number {
    const key = tokenAddress.toLowerCase();
    let price = this.prices.get(key);
    if (price === undefined) {
      // Discovered tokens are priced on demand and cached.
      price = this.derive(key);
      this.prices.set(key, price);
    }
    return price;
  }

  usdValue(tokenAddress: string, humanAmount: number): number {
    return humanAmount * this.priceOf(tokenAddress);
  }

  /** Very rough market cap = price × total supply. */
  marketCap(token: TrackedToken): number {
    return this.priceOf(token.address) * token.totalSupply;
  }
}

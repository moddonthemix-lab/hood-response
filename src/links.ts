import { config } from './config/env.js';

const DEXSCREENER_BASE = 'https://dexscreener.com';

/**
 * Build a DexScreener link for a token. When `DEXSCREENER_CHAIN` is configured
 * we deep-link to the token page for that chain; otherwise we fall back to
 * DexScreener's universal address search, which resolves on any chain.
 */
export function dexScreenerUrl(tokenAddress: string): string {
  const addr = tokenAddress.toLowerCase();
  return config.DEXSCREENER_CHAIN
    ? `${DEXSCREENER_BASE}/${config.DEXSCREENER_CHAIN}/${addr}`
    : `${DEXSCREENER_BASE}/search?q=${addr}`;
}

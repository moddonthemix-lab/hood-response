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

/** Block-explorer token page link. */
export function explorerUrl(tokenAddress: string): string {
  const base = config.EXPLORER_BASE.replace(/\/$/, '');
  return `${base}/token/${tokenAddress.toLowerCase()}`;
}

/** One-tap Sigma bot buy link, pre-filled with the token contract. Null when
 *  no referral id is configured (SIGMA_REF). */
export function sigmaBuyUrl(tokenAddress: string): string | null {
  if (!config.SIGMA_REF) return null;
  return `https://t.me/Sigma_buyBot?start=x${config.SIGMA_REF}-${tokenAddress}`;
}

/** One-tap Based bot buy link, pre-filled with the token contract. Null when
 *  no referral id is configured (BASED_REF). */
export function basedBuyUrl(tokenAddress: string): string | null {
  if (!config.BASED_REF) return null;
  return `https://t.me/based_eth_bot?start=r_${config.BASED_REF}_b_${tokenAddress}`;
}

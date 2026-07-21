/** Canonical domain types for Swarm the Fly. */

export type Direction = 'BUY' | 'SELL';

export interface TrackedToken {
  /** Contract address (lowercased). */
  address: string;
  symbol: string;
  name: string;
  totalSupply: number;
  /** True for stablecoins so they can be filtered when IGNORE_STABLECOINS. */
  stable?: boolean;
  /** True when the token was auto-registered by discovery (not in the seed set).
   *  Its metadata (symbol/supply) may be estimated until enriched from chain. */
  discovered?: boolean;
  /** When the token was first seen (unix ms). */
  firstSeen?: number;
}

export type WalletCategory =
  | 'developer'
  | 'vc'
  | 'whale'
  | 'market_maker'
  | 'influencer'
  | 'retail'
  | 'internal'
  | 'unknown';

export interface TrackedWallet {
  /** Address (lowercased). */
  address: string;
  label: string;
  category: WalletCategory;
  notes?: string;
  /** Operator confidence in this wallet, 0..1. Feeds the conviction score. */
  confidence: number;
  /** Tokens (symbols) this wallet is a known top-holder of. */
  holdsTokens: string[];
}

/** A decoded swap emitted by the chain listener + decoder. */
export interface SwapEvent {
  txHash: string;
  wallet: string;
  token: string; // token contract address (lowercased)
  tokenSymbol: string;
  direction: Direction;
  /** Token amount (human units). */
  amount: number;
  /** Notional USD value of the swap. */
  usdValue: number;
  blockNumber: number;
  /** Unix ms. */
  timestamp: number;
}

/** Breakdown of the 0..100 conviction score for a detected swarm. */
export interface ConvictionBreakdown {
  walletQuality: number;
  walletCount: number;
  totalCapital: number;
  velocity: number;
  liquidity: number;
  marketCap: number;
  historicalAccuracy: number;
  buySellRatio: number;
}

export type SwarmKind = 'BUY' | 'SELL' | 'ROTATION' | 'SOLO';

export interface Swarm {
  id: string;
  kind: SwarmKind;
  token: string;
  tokenSymbol: string;
  /** For rotation swarms, the token being rotated into. */
  rotatedIntoSymbol?: string;
  walletCount: number;
  /** Addresses are retained for engine logic (rotation matching) but are not
   *  surfaced in alerts or the dashboard — see `walletSummary` for display. */
  wallets: string[];
  /** Privacy-preserving makeup for display, e.g. "2 smart-money · 1 whale". */
  walletSummary: string;
  totalUsd: number;
  /** Token market cap (USD) at the moment of the swarm — the cap the wallets
   *  bought or sold into. */
  marketCap: number;
  /** True when this swarm is on a token discovered by tracked wallets rather
   *  than one from the original seed set — the early-discovery signal. */
  newToken: boolean;
  /** DexScreener link for the token (precise pair page when known). */
  dexUrl: string;
  /** True when price/market cap came from a live DexScreener pair (vs synthetic). */
  priceLive: boolean;
  conviction: number;
  convictionBreakdown: ConvictionBreakdown;
  windowSeconds: number;
  firstSeen: number;
  lastSeen: number;
}

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  minWallets: number;
  windowSeconds: number;
  minUsd: number;
  minConviction: number;
  cooldownSeconds: number;
  /** Only fire when the token's market cap is at or below this (USD). Omit for
   *  no cap limit. Used by solo-buy rules to target low-cap coins. */
  maxMarketCap?: number;
  /** Which directions this rule fires on. */
  kinds: SwarmKind[];
  ignoredTokens: string[];
  ignoredWallets: string[];
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  swarm: Swarm;
  createdAt: number;
  deliveries: NotificationDelivery[];
}

export interface NotificationDelivery {
  channel: 'discord' | 'telegram' | 'webhook';
  ok: boolean;
  detail?: string;
  at: number;
}

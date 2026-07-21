import type { MomentumReport } from '../types.js';

/**
 * Volume + momentum confirmation.
 *
 * A gem is stronger when it is actually trading and moving the right way. This
 * turns DexScreener volume / price-change / buy-sell counts into a confirmation
 * flag and a small conviction boost. Pure and unit-tested; the price oracle
 * feeds it the live pair data.
 */
export interface MomentumInput {
  volumeUsd: number | null;
  priceChange1h: number | null;
  priceChange24h: number | null;
  buys: number | null;
  sells: number | null;
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export function computeMomentum(input: MomentumInput): MomentumReport {
  const { volumeUsd, priceChange1h, priceChange24h, buys, sells } = input;
  const priceChangePct = priceChange1h ?? priceChange24h;

  const totalTx = (buys ?? 0) + (sells ?? 0);
  const buyPressurePct = totalTx > 0 ? ((buys ?? 0) / totalTx) * 100 : null;

  const hasVolume = volumeUsd != null && volumeUsd > 0;
  const rising = (priceChangePct ?? 0) > 0;
  const buyLean = (buyPressurePct ?? 0) > 55;
  const confirmed = hasVolume && (rising || buyLean);

  // Boost: up to +8 for upward price move, up to +7 for buy pressure.
  let boost = 0;
  if (hasVolume) {
    if (priceChangePct != null && priceChangePct > 0) {
      boost += clamp(priceChangePct / 10, 0, 1) * 8;
    }
    if (buyPressurePct != null && buyPressurePct > 50) {
      boost += clamp((buyPressurePct - 50) / 50, 0, 1) * 7;
    }
  }

  return {
    volumeUsd,
    priceChangePct,
    priceChange1h,
    priceChange24h,
    buys,
    sells,
    buyPressurePct: buyPressurePct != null ? Math.round(buyPressurePct) : null,
    confirmed,
    boost: Math.round(boost),
  };
}

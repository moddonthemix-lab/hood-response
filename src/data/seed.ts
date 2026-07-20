import type { TrackedToken, TrackedWallet, WalletCategory } from '../types.js';

/**
 * Source of truth: "Robinhood Smart-Money Conviction List" (generated
 * 2026-07-20). Top holders of 8 tracked tokens, LP pools / Permit2 / burn
 * addresses excluded. Tokens and the 72 unique wallets below are derived
 * deterministically from this table, so there is a single place to update.
 */

interface RawToken {
  symbol: string;
  name: string;
  address: string;
  totalSupply: number;
  stable?: boolean;
}

interface RawHolder {
  address: string;
  pct: number;
}

const RAW_TOKENS: RawToken[] = [
  { symbol: 'CASHCAT', name: 'CASH CAT', address: '0x020bfC650A365f8BB26819deAAbF3E21291018b4', totalSupply: 1_000_000_000 },
  { symbol: 'TENDIES', name: 'TENDIES', address: '0x45242320DBB855EeA8Fd36804C6487E10E97FCF9', totalSupply: 1_000_000_000 },
  { symbol: 'PONS', name: 'PONS', address: '0x39dBED3a2bd333467115dE45665cC57F813C4571', totalSupply: 1_000_000_000 },
  { symbol: 'INDEX', name: 'INDEX', address: '0x56910D4409F3a0C78C64DD8D0545FF0705389870', totalSupply: 1_000_000_000 },
  { symbol: 'STONKBROKER', name: 'STONKBROKERS', address: '0xe934e36A439C94017B64a3FecE66AF12099aBF50', totalSupply: 2_709_197_750 },
  { symbol: 'VEX', name: 'VEX', address: '0x8Ff92566f2e81BDd68EDfAa8cde73942A723796b', totalSupply: 1_000_000_000 },
  { symbol: 'JUGGERNAUT', name: 'JUGGERNAUT', address: '0xD7321801CAae694090694Ff55A9323139F043B88', totalSupply: 1_000_000_000 },
  { symbol: 'WISHBONE', name: 'WISHBONE', address: '0x77581054581B9c525E7dd7a0155DE43867532d03', totalSupply: 1_000_000_000 },
];

const RAW_HOLDERS: Record<string, RawHolder[]> = {
  CASHCAT: [
    { address: '0x2dBAf98620aC5Bbe3441f756fEfF82702D095b1a', pct: 3.35 },
    { address: '0xeb877e7b5614B1Ca58c6b00eC4FFCd248eD414ee', pct: 1.7 },
    { address: '0xc69183690b42D6A51631dcB34F2F26CeA7F6a273', pct: 1.37 },
    { address: '0x7c85a758c75b4dFCd00A1730863A7520F90AA08D', pct: 1.34 },
    { address: '0x9963597a9246b39b13330992F571F8378c18c262', pct: 1.15 },
    { address: '0x3EA937589eA5eE0FBcCbcCeF29473E7f957a19a5', pct: 1.02 },
    { address: '0x03e8FB0f68D497936231A1DE70F84bC33B568529', pct: 1.01 },
    { address: '0x5638484ba2d2F1D1D35020572B0Aa439a9869192', pct: 0.99 },
    { address: '0x77acC36fCC41DC3BFB51441E003831c74D4ecAF0', pct: 0.82 },
    { address: '0xF0C9977eE6278E5544168C76A5eD25b8Bf9F3936', pct: 0.71 },
  ],
  TENDIES: [
    { address: '0xD1BF5f917EA367b37cb4Eec6D41D8433a12fC8fD', pct: 1.59 },
    { address: '0x8F62A08537cede87D511AcA6436274Ab4Ca080a3', pct: 1.58 },
    { address: '0x9963597a9246b39b13330992F571F8378c18c262', pct: 1.41 },
    { address: '0x71f2F1c2dc94cDaBFE29Cb355119f8683AE0969b', pct: 1.21 },
    { address: '0x6ed3b31B6062679868C1036d3667c44AfaD44d56', pct: 1.11 },
    { address: '0x7c3D0402278366a3e1ed3f2b997005b7cA0e1EBE', pct: 1.09 },
    { address: '0xC0F2d453E98Aa30064bA8f766a146978419987f3', pct: 1.01 },
    { address: '0xC52FBB9C4a7373b85De6415f888e5E2e3F195176', pct: 1.0 },
    { address: '0xFD6e86cf9AECA787CFFB198BCA859d459a44a847', pct: 1.0 },
    { address: '0x11C8678069c46B74C62A8a94B21784DFb771b8d3', pct: 1.0 },
  ],
  PONS: [
    { address: '0x194d98d18113bDD5720A0a89FE2F98C75ECe7344', pct: 1.27 },
    { address: '0x0c175C6a0065EE05F871A68783D2dE432a1e6Cbe', pct: 1.15 },
    { address: '0xD3A61BA3BD055F6AA962Cc7554E117B4bAf8d0A5', pct: 1.11 },
    { address: '0xd874259110C6E086F1d2feE474b73e69b8F5DAB0', pct: 1.1 },
    { address: '0x0a6EBEd0155EDB4b21D92AD02897A626CD90119E', pct: 1.1 },
    { address: '0x7e3Ba68C49561AaE7c23C1d20fEF0F1D7615a3ad', pct: 1.02 },
    { address: '0x61C0293D364C7F1927993689F95fD14334e7f7E2', pct: 1.02 },
    { address: '0x38053BB358106b2d212c3130dcd28Df19f2D2EFF', pct: 1.0 },
    { address: '0x0eF27ea387dB2791C5C50CEA43bE5b5503701803', pct: 0.99 },
    { address: '0xe16d837A2099B7b8f5AA117F82099C4D115f868B', pct: 0.95 },
  ],
  INDEX: [
    { address: '0xB646Fa75E09b37327505106e39D84b89c4E68413', pct: 2.01 },
    { address: '0x14e468E79D14606035A86A6B068A93BeaDa853f8', pct: 1.87 },
    { address: '0x4671fb2fB50a8001E13523a8a3dF37Bc67777777', pct: 1.73 },
    { address: '0x7Da8b5A80539A0F960C91ae0830A22a807Edd739', pct: 1.32 },
    { address: '0xC26912365421474C271e9a7C6c534419Dc9D7a38', pct: 1.27 },
    { address: '0xbb3b32E63F6B2D2605A5114416398fA3839328b8', pct: 1.2 },
    { address: '0x491f8C0bB7b970A554A82721B19aa5b9E0a90455', pct: 1.13 },
    { address: '0x6Fd2e7Fa124b7d9D021935D1f99ded0D92DfFaA8', pct: 0.99 },
    { address: '0x44dF085447dBEBCf69C6675c3B8A795c7fdeB3F4', pct: 0.99 },
    { address: '0x9963597a9246b39b13330992F571F8378c18c262', pct: 0.92 },
  ],
  STONKBROKER: [
    { address: '0x799AE26fA515ceF145e8bC8636F7fFF87B05Cf62', pct: 47.86 },
    { address: '0x16027b596e210c63f750E0bdD156f00bb2749868', pct: 4.53 },
    { address: '0x0A719a1c3D997Ee54EE317dd02617Ed7EDb53e00', pct: 1.18 },
    { address: '0x5E7200a139e862C703878D89a49F810cfF8AECfA', pct: 1.11 },
    { address: '0x2DaA0456786A065ee17D1eDaCC231F9Acd6f018b', pct: 1.06 },
    { address: '0x9963597a9246b39b13330992F571F8378c18c262', pct: 1.05 },
    { address: '0x59F90189365B96A6DbE355Ed91363551160E4A7C', pct: 0.95 },
    { address: '0x5678C23be6989Cde5D0fE68D921584B4404a3180', pct: 0.89 },
    { address: '0x368cbFdf48031c07deFf5D4e05e270db29ffC085', pct: 0.66 },
    { address: '0x148Ff8c581be8A7F3536F28bDFD7C84dd109ba91', pct: 0.6 },
  ],
  VEX: [
    { address: '0x1B0d0843578dEdb0f3aF84a0C29Aaf3d0D30A6d0', pct: 25.0 },
    { address: '0xe2890629EF31b32132003C02B29a50A025dEeE8a', pct: 14.05 },
    { address: '0x829d1853D4ED1f80D6c223AE8828DBDBbC1E224a', pct: 4.49 },
    { address: '0xBAa11e7357525aE586826482B12bc07D70C25920', pct: 2.0 },
    { address: '0x740d62Ca581672A38cFf476b1c1578B061523FF8', pct: 1.93 },
    { address: '0x32e7c4AFEA4f868A53EC51435C92eD80625EeB33', pct: 1.56 },
    { address: '0xdCc200ceE7a6453FBC5E26D6c7C91708F80FCFd5', pct: 1.05 },
    { address: '0x585aD02E878364a22099da8B8217E586b79711d2', pct: 0.9 },
    { address: '0xBAf7C36C047cdA4430aae60a7F2949192721B80A', pct: 0.84 },
    { address: '0x1392C3457C47506f520Bf32992a02A1A22317DAA', pct: 0.77 },
  ],
  JUGGERNAUT: [
    { address: '0x71f2F1c2dc94cDaBFE29Cb355119f8683AE0969b', pct: 2.75 },
    { address: '0x8E65cbcDc822968131B1e37E5CEE02c9CE82Ab21', pct: 2.05 },
    { address: '0xf19E3D2E4635ef23332F21f2962fFC49c40d4858', pct: 2.0 },
    { address: '0xa7129618475E8076D721490Cfb30fe62bc5CC7B9', pct: 1.57 },
    { address: '0xe53bdb2118585d5B2cD06a117d3A036AFA70677a', pct: 1.36 },
    { address: '0x0c175C6a0065EE05F871A68783D2dE432a1e6Cbe', pct: 1.31 },
    { address: '0x4F835C3bbE19b569FBFceaBc42C95631F354B532', pct: 1.1 },
    { address: '0x5638484ba2d2F1D1D35020572B0Aa439a9869192', pct: 1.08 },
    { address: '0x491f8C0bB7b970A554A82721B19aa5b9E0a90455', pct: 1.02 },
    { address: '0x9963597a9246b39b13330992F571F8378c18c262', pct: 1.0 },
  ],
  WISHBONE: [
    { address: '0x0F0732ffD97CEdF619bd969ec93b25F8Fc1231DC', pct: 2.53 },
    { address: '0xa2d9051c139ec1Ba9c4EB3cAB1bBF5D313EA408d', pct: 1.84 },
    { address: '0xF91f3c2f3cEAfFe42bf1f47bec7Ac43038730157', pct: 1.78 },
    { address: '0xAAfA64632E0873BfAb19f051E0C4b768C992638c', pct: 1.41 },
    { address: '0x2f25b929f03Fe2869e752f1910e5445f8B5778dA', pct: 1.37 },
    { address: '0xB89C70e8EfA86e184591744b11587c7EF7cB5e60', pct: 1.37 },
    { address: '0x98c43dA65205b7c53A857d79f3D1F6fBC0b76fA5', pct: 1.24 },
    { address: '0x0e0cb46e1ddfcCeD88AB552871d88dF52D61AD9E', pct: 1.18 },
    { address: '0xF7c198EBa890b67F6FcA21aAF3944866ACBC7ffe', pct: 1.15 },
    { address: '0x60118B5e13C3DB8B1E5d446C410f12F343d7d1db', pct: 1.1 },
  ],
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

function categorize(maxPct: number, coinCount: number): WalletCategory {
  if (maxPct >= 4) return 'whale';
  if (coinCount >= 3) return 'internal';
  if (coinCount >= 2) return 'vc';
  return 'retail';
}

/** Build the immutable seed catalogs once at module load. */
function build(): { tokens: TrackedToken[]; wallets: TrackedWallet[] } {
  const tokens: TrackedToken[] = RAW_TOKENS.map((t) => ({
    address: t.address.toLowerCase(),
    symbol: t.symbol,
    name: t.name,
    totalSupply: t.totalSupply,
    stable: t.stable ?? false,
  }));

  interface Acc {
    address: string;
    holdsTokens: Set<string>;
    maxPct: number;
  }
  const byWallet = new Map<string, Acc>();

  for (const [symbol, holders] of Object.entries(RAW_HOLDERS)) {
    for (const h of holders) {
      const key = h.address.toLowerCase();
      const acc = byWallet.get(key) ?? {
        address: key,
        holdsTokens: new Set<string>(),
        maxPct: 0,
      };
      acc.holdsTokens.add(symbol);
      acc.maxPct = Math.max(acc.maxPct, h.pct);
      byWallet.set(key, acc);
    }
  }

  const wallets: TrackedWallet[] = [...byWallet.values()].map((acc) => {
    const coins = [...acc.holdsTokens].sort();
    const coinCount = coins.length;
    const category = categorize(acc.maxPct, coinCount);
    // Confidence: base + reward for cross-coin conviction + holding size.
    const confidence = clamp01(
      0.45 + (coinCount - 1) * 0.12 + Math.min(acc.maxPct / 50, 0.25),
    );
    const label =
      coinCount > 1
        ? `Smart money · ${coinCount} coins`
        : `Top holder · ${coins[0]}`;
    return {
      address: acc.address,
      label,
      category,
      confidence: Number(confidence.toFixed(3)),
      holdsTokens: coins,
      notes:
        coinCount > 1
          ? `Cross-coin conviction wallet: ${coins.join(', ')}`
          : undefined,
    };
  });

  // Highest conviction first for stable ordering in the API/dashboard.
  wallets.sort(
    (a, b) => b.holdsTokens.length - a.holdsTokens.length || b.confidence - a.confidence,
  );

  return { tokens, wallets };
}

const seeded = build();

export const SEED_TOKENS: readonly TrackedToken[] = seeded.tokens;
export const SEED_WALLETS: readonly TrackedWallet[] = seeded.wallets;

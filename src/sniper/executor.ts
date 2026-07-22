import {
  JsonRpcProvider,
  Wallet,
  Contract,
  AbiCoder,
  keccak256,
  parseEther,
  formatEther,
  formatUnits,
  getAddress,
  dataSlice,
  zeroPadValue,
  concat,
  ZeroAddress,
  MaxUint256,
} from 'ethers';
import { config } from '../config/env.js';
import { logger } from '../logger.js';

// ── Robinhood Chain Uniswap-v4 constants (verified from official + Bags docs) ──
// The UniversalRouter is Robinhood's MODIFIED fork: its v4 swap struct carries
// an extra `minHopPriceX36` field (always 0), so stock Uniswap SDK calldata
// reverts. Pool params VARY per token, so the executor resolves each token's
// real PoolKey on-chain instead of assuming one shape.
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const V4_QUOTER = '0x8dc178efb8111bb0973dd9d722ebeff267c98f94';
const POSITION_MANAGER = '0x58daec3116aae6d93017baaea7749052e8a04fa7';
const POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
const STATE_VIEW = '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b';
// PoolManager.Initialize(id, currency0, currency1, fee, tickSpacing, hooks, sqrtPriceX96, tick)
// topics: [sig, id, currency0, currency1]; data: fee,tickSpacing,hooks,sqrtPriceX96,tick
const INIT_TOPIC = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
const BAGS_HOOK = '0x2380aBf72C17aABAb76480244759AC7E2932EEcC';
const DYNAMIC_FEE = 0x800000;
const ADDRESS_THIS = '0x0000000000000000000000000000000000000002'; // UR: the router itself

// UniversalRouter command bytes
const CMD_WRAP_ETH = '0x0b';
const CMD_UNWRAP_WETH = '0x0c';
const CMD_V4_SWAP = '0x10';
// v4 action bytes
const ACT_SWAP_EXACT_IN_SINGLE = '06';
const ACT_SETTLE_ALL = '0c';
const ACT_TAKE_ALL = '0f';

const ROUTER_ABI = ['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'];
// V4Quoter.quoteExactInputSingle takes ONE struct arg.
const QUOTER_ABI = [
  'function quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes) params) returns (uint256 amountOut, uint256 gasEstimate)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];
const PERMIT2_ABI = [
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
];
// v4-periphery: PositionManager keeps a poolId(first 25 bytes) -> PoolKey map.
const POSM_ABI = [
  'function poolKeys(bytes25 poolId) view returns (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)',
];
const STATE_VIEW_ABI = [
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
];

export interface BuyResult {
  txHash: string;
  tokensReceived: number;
  ethSpent: number;
}
export interface SellResult {
  txHash: string;
  ethReceived: number;
  tokensSold: number;
}

/** A token's resolved v4 pool: the exact key plus which side the token is. */
interface ResolvedPool {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  /** The pool's quote side (what ETH enters as): WETH or native (0x0). */
  ethCurrency: string;
  /** True when the token is currency0. */
  tokenIs0: boolean;
}

const abi = AbiCoder.defaultAbiCoder();

/** Trim an ethers/RPC error down to a short, human reason for the decision log. */
function shortErr(err: unknown): string {
  const e = err as { shortMessage?: string; reason?: string; message?: string };
  return (e.shortMessage || e.reason || e.message || String(err)).slice(0, 90);
}

const keyTuple = (p: ResolvedPool) =>
  [p.currency0, p.currency1, p.fee, p.tickSpacing, p.hooks] as const;

const poolIdOf = (p: ResolvedPool): string =>
  keccak256(
    abi.encode(['address', 'address', 'uint24', 'int24', 'address'], [...keyTuple(p)]),
  );

/**
 * Executes ETH↔token swaps on Robinhood Chain through the modified v4
 * UniversalRouter. Each token's PoolKey is RESOLVED on-chain (DexScreener pool
 * id → PositionManager registry, else candidate probing via StateView), so we
 * trade the pool that actually exists instead of assuming its parameters.
 */
export class SwapExecutor {
  private provider: JsonRpcProvider | null = null;
  private wallet: Wallet | null = null;
  private runtimeKey: string | null = null;
  private readonly pools = new Map<string, ResolvedPool>();

  private key(): string {
    return this.runtimeKey ?? config.SNIPER_PRIVATE_KEY;
  }

  get ready(): boolean {
    return this.key().length > 0 && config.SNIPER_ROUTER.length > 0 && config.SNIPER_WETH.length > 0;
  }

  /** Set the hot-wallet key at runtime (from the dashboard). Not persisted. */
  setPrivateKey(pk: string): string {
    const clean = pk.trim();
    const w = new Wallet(clean); // throws on a bad key
    this.runtimeKey = clean;
    this.wallet = null; // force rebuild with the new key
    return w.address;
  }

  private init(): void {
    if (this.wallet || !this.ready) return;
    const rpc = config.CHAIN_HTTP_URL || 'https://rpc.mainnet.chain.robinhood.com';
    this.provider = new JsonRpcProvider(rpc);
    this.wallet = new Wallet(this.key(), this.provider);
  }

  address(): string | null {
    this.init();
    return this.wallet?.address ?? null;
  }

  async balanceEth(): Promise<number | null> {
    this.init();
    if (!this.wallet || !this.provider) return null;
    try {
      return Number(formatEther(await this.provider.getBalance(this.wallet.address)));
    } catch {
      return null;
    }
  }

  // ── Pool discovery ──────────────────────────────────────────────────────────

  /** Resolve a pool from the PoolManager's Initialize event (the definitive
   *  source — every v4 pool emits its full PoolKey at creation). Prefers a pool
   *  paired with WETH or native ETH when a token has several. */
  private async resolveFromInitEvent(token: string): Promise<ResolvedPool | null> {
    if (!this.provider) return null;
    const t = getAddress(token);
    const padded = zeroPadValue(t, 32);
    const weth = getAddress(config.SNIPER_WETH);
    const base = { address: POOL_MANAGER, fromBlock: 0, toBlock: 'latest' as const };
    const found: ResolvedPool[] = [];
    for (const topics of [
      [INIT_TOPIC, null, padded], // currency0 == token
      [INIT_TOPIC, null, null, padded], // currency1 == token
    ]) {
      let logs;
      try {
        logs = await this.provider.getLogs({ ...base, topics });
      } catch (err) {
        logger.debug({ token, err: String(err) }, 'sniper: Initialize getLogs failed');
        continue;
      }
      for (const log of logs) {
        try {
          const c0 = getAddress(dataSlice(log.topics[2]!, 12));
          const c1 = getAddress(dataSlice(log.topics[3]!, 12));
          const decoded = abi.decode(['uint24', 'int24', 'address', 'uint160', 'int24'], log.data);
          const fee = decoded[0] as bigint;
          const tickSpacing = decoded[1] as bigint;
          const hooks = decoded[2] as string;
          const tokenIs0 = c0.toLowerCase() === t.toLowerCase();
          found.push({
            currency0: c0,
            currency1: c1,
            fee: Number(fee),
            tickSpacing: Number(tickSpacing),
            hooks: getAddress(hooks),
            ethCurrency: tokenIs0 ? c1 : c0,
            tokenIs0,
          });
        } catch {
          /* skip malformed log */
        }
      }
    }
    if (found.length === 0) return null;
    // Only ETH/WETH-paired pools are buyable with a single-hop ETH swap.
    const ethPaired = found.filter((p) => p.ethCurrency === weth || p.ethCurrency === ZeroAddress);
    if (ethPaired.length === 0) {
      throw new Error(
        `token has a pool but it's not ETH/WETH-paired (vs ${found[0]!.ethCurrency.slice(0, 10)}…) — can't buy with ETH`,
      );
    }
    const pick = ethPaired[ethPaired.length - 1]!;
    logger.info(
      { token, pool: { fee: pick.fee, tickSpacing: pick.tickSpacing, hooks: pick.hooks, eth: pick.ethCurrency }, pools: found.length },
      'sniper: pool resolved from Initialize event',
    );
    return pick;
  }

  private buildPool(token: string, eth: string, fee: number, tickSpacing: number, hooks: string): ResolvedPool {
    const t = getAddress(token);
    const c0 = eth.toLowerCase() < t.toLowerCase() ? eth : t;
    const c1 = c0 === t ? eth : t;
    return { currency0: c0, currency1: c1, fee, tickSpacing, hooks, ethCurrency: eth, tokenIs0: c0 === t };
  }

  /** True when this pool id is initialized on the PoolManager. */
  private async poolLive(p: ResolvedPool): Promise<boolean> {
    try {
      const sv = new Contract(STATE_VIEW, STATE_VIEW_ABI, this.provider!);
      const [sqrtPrice] = (await sv.getFunction('getSlot0')(poolIdOf(p))) as [bigint];
      return sqrtPrice > 0n;
    } catch {
      return false;
    }
  }

  /**
   * Resolve the token's actual pool. Order:
   *  1. `poolIdHint` (DexScreener's v4 pair id) → PositionManager.poolKeys —
   *     exact key, zero guessing.
   *  2. Probe likely candidates (WETH or native × Bags-dynamic or standard
   *     static fee tiers) against StateView until one is initialized.
   */
  private async resolvePool(token: string, poolIdHint?: string | null): Promise<ResolvedPool> {
    const cached = this.pools.get(token.toLowerCase());
    if (cached) return cached;

    // 1) Authoritative: the PoolManager's Initialize event carries the full
    // PoolKey for every pool ever created — works for Bags pools that never
    // touch the PositionManager registry.
    const fromEvent = await this.resolveFromInitEvent(token);
    if (fromEvent) {
      this.pools.set(token.toLowerCase(), fromEvent);
      return fromEvent;
    }

    // 2) Exact lookup from the on-chain registry via the DexScreener pool id.
    if (poolIdHint && /^0x[0-9a-fA-F]{64}$/.test(poolIdHint)) {
      try {
        const posm = new Contract(POSITION_MANAGER, POSM_ABI, this.provider!);
        const res = (await posm.getFunction('poolKeys')(dataSlice(poolIdHint, 0, 25))) as [
          string, string, bigint, bigint, string,
        ];
        const [c0, c1, fee, tickSpacing, hooks] = res;
        const t = getAddress(token);
        if (getAddress(c0) === t || getAddress(c1) === t) {
          const eth = getAddress(c0) === t ? getAddress(c1) : getAddress(c0);
          const pool: ResolvedPool = {
            currency0: getAddress(c0),
            currency1: getAddress(c1),
            fee: Number(fee),
            tickSpacing: Number(tickSpacing),
            hooks: getAddress(hooks),
            ethCurrency: eth,
            tokenIs0: getAddress(c0) === t,
          };
          this.pools.set(token.toLowerCase(), pool);
          logger.info({ token, pool: { fee: pool.fee, tickSpacing: pool.tickSpacing, hooks: pool.hooks, eth } }, 'sniper: pool resolved from registry');
          return pool;
        }
      } catch (err) {
        logger.debug({ token, err: String(err) }, 'sniper: registry lookup failed, probing candidates');
      }
    }

    // 2) Candidate probing.
    const weth = getAddress(config.SNIPER_WETH);
    const candidates: [string, number, number, string][] = [
      [weth, DYNAMIC_FEE, 50, BAGS_HOOK],
      [ZeroAddress, DYNAMIC_FEE, 50, BAGS_HOOK],
      [weth, 3000, 60, ZeroAddress],
      [ZeroAddress, 3000, 60, ZeroAddress],
      [weth, 10000, 200, ZeroAddress],
      [ZeroAddress, 10000, 200, ZeroAddress],
      [weth, 500, 10, ZeroAddress],
    ];
    for (const [eth, fee, ts, hooks] of candidates) {
      const pool = this.buildPool(token, eth, fee, ts, hooks);
      if (await this.poolLive(pool)) {
        this.pools.set(token.toLowerCase(), pool);
        logger.info({ token, pool: { fee, tickSpacing: ts, hooks, eth } }, 'sniper: pool resolved by probing');
        return pool;
      }
    }
    throw new Error('no initialized v4 pool found for this token');
  }

  // ── Quotes ──────────────────────────────────────────────────────────────────

  /** Quote amount-out for an exact amount-in. `ethIn` = ETH→token direction. */
  private async quoteOut(pool: ResolvedPool, amountIn: bigint, ethIn: boolean): Promise<bigint> {
    const zeroForOne = ethIn ? !pool.tokenIs0 : pool.tokenIs0;
    const quoter = new Contract(V4_QUOTER, QUOTER_ABI, this.wallet!);
    const fn = (quoter.getFunction('quoteExactInputSingle') as unknown as {
      staticCall: (params: unknown) => Promise<[bigint, bigint]>;
    }).staticCall;
    const [amountOut] = await fn([keyTuple(pool), zeroForOne, amountIn, '0x']);
    return amountOut;
  }

  private minOut(quoted: bigint): bigint {
    const bps = BigInt(Math.round((100 - config.SNIPER_SLIPPAGE_PCT) * 100));
    return (quoted * bps) / 10_000n;
  }

  /** Encode the modified v4 SWAP_EXACT_IN_SINGLE params (extra minHopPriceX36). */
  private encodeSwapParams(pool: ResolvedPool, zeroForOne: boolean, amountIn: bigint, amountOutMin: bigint): string {
    return abi.encode(
      ['tuple(address,address,uint24,int24,address)', 'bool', 'uint128', 'uint128', 'uint256', 'bytes'],
      [[...keyTuple(pool)], zeroForOne, amountIn, amountOutMin, 0n, '0x'],
    );
  }

  // ── Trades ──────────────────────────────────────────────────────────────────

  async buy(token: string, ethAmount: number, poolIdHint?: string | null): Promise<BuyResult> {
    this.init();
    if (!this.wallet) throw new Error('sniper wallet not configured');
    const pool = await this.resolvePool(token, poolIdHint);
    const amountIn = parseEther(ethAmount.toString());

    let quoted: bigint;
    try {
      quoted = await this.quoteOut(pool, amountIn, true);
    } catch (err) {
      throw new Error(`quote reverted (${shortErr(err)})`);
    }
    if (quoted <= 0n) throw new Error('no route (zero quote)');
    const amountOutMin = this.minOut(quoted);
    const zeroForOne = !pool.tokenIs0; // ETH side → token

    const actions = '0x' + ACT_SWAP_EXACT_IN_SINGLE + ACT_SETTLE_ALL + ACT_TAKE_ALL;
    const params = [
      this.encodeSwapParams(pool, zeroForOne, amountIn, amountOutMin),
      abi.encode(['address', 'uint256'], [pool.ethCurrency, amountIn]), // SETTLE_ALL(eth side)
      abi.encode(['address', 'uint256'], [getAddress(token), amountOutMin]), // TAKE_ALL(token)
    ];
    const v4Input = abi.encode(['bytes', 'bytes[]'], [actions, params]);

    // WETH pools: wrap the sent ETH inside the router first. Native pools: the
    // router settles native directly from msg.value.
    const nativePool = pool.ethCurrency === ZeroAddress;
    const commands = nativePool ? CMD_V4_SWAP : concat([CMD_WRAP_ETH, CMD_V4_SWAP]);
    const inputs = nativePool
      ? [v4Input]
      : [abi.encode(['address', 'uint256'], [ADDRESS_THIS, amountIn]), v4Input];

    const token20 = new Contract(token, ERC20_ABI, this.wallet);
    const before = (await token20.getFunction('balanceOf')(this.wallet.address)) as bigint;

    const router = new Contract(config.SNIPER_ROUTER, ROUTER_ABI, this.wallet);
    const deadline = Math.floor(Date.now() / 1000) + 120;
    let tx;
    try {
      tx = await router.getFunction('execute')(commands, inputs, deadline, { value: amountIn });
    } catch (err) {
      throw new Error(`swap reverted (${shortErr(err)})`);
    }
    logger.info({ token, ethAmount, tx: tx.hash }, 'sniper: buy sent');
    await tx.wait(1);

    let tokensReceived = 0;
    try {
      const after = (await token20.getFunction('balanceOf')(this.wallet.address)) as bigint;
      const decimals = Number((await token20.getFunction('decimals')()) as bigint);
      tokensReceived = Number(formatUnits(after - before, decimals));
    } catch {
      /* balance read failed — tx still landed */
    }
    return { txHash: tx.hash, tokensReceived, ethSpent: ethAmount };
  }

  /** Ensure Permit2's two-leg allowance so the router can pull the token. */
  private async ensurePermit2(token: string, amount: bigint): Promise<void> {
    if (!this.wallet) return;
    const token20 = new Contract(token, ERC20_ABI, this.wallet);
    const erc20Allowance = (await token20.getFunction('allowance')(this.wallet.address, PERMIT2)) as bigint;
    if (erc20Allowance < amount) {
      await (await token20.getFunction('approve')(PERMIT2, MaxUint256)).wait(1);
    }
    const permit2 = new Contract(PERMIT2, PERMIT2_ABI, this.wallet);
    const [allowed] = (await permit2.getFunction('allowance')(
      this.wallet.address,
      token,
      config.SNIPER_ROUTER,
    )) as [bigint, bigint, bigint];
    if (allowed < amount) {
      const maxUint160 = (1n << 160n) - 1n;
      const expiration = Math.floor(Date.now() / 1000) + 30 * 86_400;
      await (await permit2.getFunction('approve')(token, config.SNIPER_ROUTER, maxUint160, expiration)).wait(1);
    }
  }

  async sell(token: string, poolIdHint?: string | null): Promise<SellResult> {
    this.init();
    if (!this.wallet) throw new Error('sniper wallet not configured');
    const pool = await this.resolvePool(token, poolIdHint);
    const token20 = new Contract(token, ERC20_ABI, this.wallet);
    const bal = (await token20.getFunction('balanceOf')(this.wallet.address)) as bigint;
    if (bal <= 0n) throw new Error('no token balance to sell');
    const decimals = Number((await token20.getFunction('decimals')()) as bigint);

    await this.ensurePermit2(token, bal);

    let quotedOut = 0n;
    try {
      quotedOut = await this.quoteOut(pool, bal, false);
    } catch (err) {
      throw new Error(`sell quote reverted (${shortErr(err)})`);
    }
    const amountOutMin = this.minOut(quotedOut);
    const zeroForOne = pool.tokenIs0; // token → ETH side

    const actions = '0x' + ACT_SWAP_EXACT_IN_SINGLE + ACT_SETTLE_ALL + ACT_TAKE_ALL;
    const params = [
      this.encodeSwapParams(pool, zeroForOne, bal, amountOutMin),
      abi.encode(['address', 'uint256'], [getAddress(token), bal]), // SETTLE_ALL(token)
      abi.encode(['address', 'uint256'], [pool.ethCurrency, amountOutMin]), // TAKE_ALL(eth side)
    ];
    const v4Input = abi.encode(['bytes', 'bytes[]'], [actions, params]);

    // WETH pools: unwrap the WETH back to native for the wallet. Native pools:
    // the router takes native straight to the recipient — no unwrap needed.
    const nativePool = pool.ethCurrency === ZeroAddress;
    const commands = nativePool ? CMD_V4_SWAP : concat([CMD_V4_SWAP, CMD_UNWRAP_WETH]);
    const inputs = nativePool
      ? [v4Input]
      : [v4Input, abi.encode(['address', 'uint256'], [this.wallet.address, amountOutMin])];

    const router = new Contract(config.SNIPER_ROUTER, ROUTER_ABI, this.wallet);
    const deadline = Math.floor(Date.now() / 1000) + 120;
    let tx;
    try {
      tx = await router.getFunction('execute')(commands, inputs, deadline);
    } catch (err) {
      throw new Error(`sell swap reverted (${shortErr(err)})`);
    }
    logger.info({ token, tx: tx.hash }, 'sniper: sell sent');
    await tx.wait(1);
    return {
      txHash: tx.hash,
      ethReceived: Number(formatEther(quotedOut)),
      tokensSold: Number(formatUnits(bal, decimals)),
    };
  }
}

import {
  JsonRpcProvider,
  Wallet,
  Contract,
  AbiCoder,
  parseEther,
  formatEther,
  formatUnits,
  getAddress,
  concat,
  MaxUint256,
} from 'ethers';
import { config } from '../config/env.js';
import { logger } from '../logger.js';

// ── Robinhood Chain Uniswap-v4 constants (from official + Bags docs) ──────────
// The UniversalRouter is Robinhood's MODIFIED fork: its v4 swap struct carries
// an extra `minHopPriceX36` field (always 0), so stock Uniswap SDK calldata
// reverts. Pools are dynamic-fee, tickSpacing 50, behind the BagsV4 hook.
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const V4_QUOTER = '0x8dc178efb8111bb0973dd9d722ebeff267c98f94';
const HOOK = '0x2380aBf72C17aABAb76480244759AC7E2932EEcC';
const POOL_FEE = 0x800000; // dynamic-fee flag
const TICK_SPACING = 50;
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
// V4Quoter.quoteExactInputSingle takes ONE struct arg:
//   QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData }
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

const abi = AbiCoder.defaultAbiCoder();

/** Trim an ethers/RPC error down to a short, human reason for the decision log. */
function shortErr(err: unknown): string {
  const e = err as { shortMessage?: string; reason?: string; message?: string };
  return (e.shortMessage || e.reason || e.message || String(err)).slice(0, 90);
}

/** currency0/currency1 are the sorted (token, WETH) pair. */
function poolKey(token: string): { currency0: string; currency1: string; wethIsCurrency0: boolean } {
  const t = getAddress(token);
  const w = getAddress(config.SNIPER_WETH);
  const wethIsCurrency0 = w.toLowerCase() < t.toLowerCase();
  return wethIsCurrency0
    ? { currency0: w, currency1: t, wethIsCurrency0 }
    : { currency0: t, currency1: w, wethIsCurrency0 };
}

/**
 * Executes ETH↔token swaps on Robinhood Chain through the modified v4
 * UniversalRouter. Built from Robinhood's documented (non-standard) calldata;
 * MUST be validated with a small real test-buy before trusting it — it cannot
 * be tested off-chain. The private key comes from env OR is set in-app at
 * runtime (memory only, never persisted).
 */
export class SwapExecutor {
  private provider: JsonRpcProvider | null = null;
  private wallet: Wallet | null = null;
  private runtimeKey: string | null = null;

  private key(): string {
    return this.runtimeKey ?? config.SNIPER_PRIVATE_KEY;
  }

  get ready(): boolean {
    return this.key().length > 0 && config.SNIPER_ROUTER.length > 0 && config.SNIPER_WETH.length > 0;
  }

  /** Set the hot-wallet key at runtime (from the dashboard). Not persisted. */
  setPrivateKey(pk: string): string {
    const clean = pk.trim();
    // Validate by constructing a wallet; throws on a bad key.
    const w = new Wallet(clean);
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

  /** Quote token-out for an exact amount-in on the token/WETH pool. Throws with
   *  the underlying revert reason so callers can surface why routing failed. */
  private async quoteOut(token: string, amountIn: bigint, zeroForOne: boolean): Promise<bigint> {
    const quoter = new Contract(V4_QUOTER, QUOTER_ABI, this.wallet!);
    const pk = poolKey(token);
    const key = [pk.currency0, pk.currency1, POOL_FEE, TICK_SPACING, HOOK];
    const fn = (quoter.getFunction('quoteExactInputSingle') as unknown as {
      staticCall: (params: unknown) => Promise<[bigint, bigint]>;
    }).staticCall;
    const [amountOut] = await fn([key, zeroForOne, amountIn, '0x']);
    return amountOut;
  }

  /** Read-only route check: expected token out for `ethAmount` in, or null. */
  async quoteBuy(token: string, ethAmount: number): Promise<bigint | null> {
    this.init();
    if (!this.wallet) return null;
    try {
      return await this.quoteOut(token, parseEther(ethAmount.toString()), poolKey(token).wethIsCurrency0);
    } catch (err) {
      logger.warn({ token, err: String(err) }, 'sniper: quote failed (routing unavailable)');
      return null;
    }
  }

  private minOut(quoted: bigint): bigint {
    const bps = BigInt(Math.round((100 - config.SNIPER_SLIPPAGE_PCT) * 100));
    return (quoted * bps) / 10_000n;
  }

  /** Encode the modified v4 SWAP_EXACT_IN_SINGLE params (extra minHopPriceX36). */
  private encodeSwapParams(token: string, zeroForOne: boolean, amountIn: bigint, amountOutMin: bigint): string {
    const pk = poolKey(token);
    return abi.encode(
      ['tuple(address,address,uint24,int24,address)', 'bool', 'uint128', 'uint128', 'uint256', 'bytes'],
      [[pk.currency0, pk.currency1, POOL_FEE, TICK_SPACING, HOOK], zeroForOne, amountIn, amountOutMin, 0n, '0x'],
    );
  }

  async buy(token: string, ethAmount: number): Promise<BuyResult> {
    this.init();
    if (!this.wallet) throw new Error('sniper wallet not configured');
    const amountIn = parseEther(ethAmount.toString());
    const pk = poolKey(token);
    const zeroForOne = pk.wethIsCurrency0; // WETH → token
    let quoted: bigint;
    try {
      quoted = await this.quoteOut(token, amountIn, zeroForOne);
    } catch (err) {
      throw new Error(`quote reverted (${shortErr(err)}) — token may not have a WETH v4 pool`);
    }
    if (quoted <= 0n) throw new Error('no route (zero quote)');
    const amountOutMin = this.minOut(quoted);
    const weth = getAddress(config.SNIPER_WETH);

    // v4 actions: swap, settle WETH (input), take token (output).
    const actions = '0x' + ACT_SWAP_EXACT_IN_SINGLE + ACT_SETTLE_ALL + ACT_TAKE_ALL;
    const params = [
      this.encodeSwapParams(token, zeroForOne, amountIn, amountOutMin),
      abi.encode(['address', 'uint256'], [weth, amountIn]), // SETTLE_ALL(WETH, amountIn)
      abi.encode(['address', 'uint256'], [getAddress(token), amountOutMin]), // TAKE_ALL(token, min)
    ];
    const v4Input = abi.encode(['bytes', 'bytes[]'], [actions, params]);
    // Wrap the incoming ETH into the router, then run the v4 swap.
    const wrapInput = abi.encode(['address', 'uint256'], [ADDRESS_THIS, amountIn]);
    const commands = concat([CMD_WRAP_ETH, CMD_V4_SWAP]);

    const token20 = new Contract(token, ERC20_ABI, this.wallet);
    const before = (await token20.getFunction('balanceOf')(this.wallet.address)) as bigint;

    const router = new Contract(config.SNIPER_ROUTER, ROUTER_ABI, this.wallet);
    const deadline = Math.floor(Date.now() / 1000) + 120;
    const tx = await router.getFunction('execute')(commands, [wrapInput, v4Input], deadline, {
      value: amountIn,
    });
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

  async sell(token: string): Promise<SellResult> {
    this.init();
    if (!this.wallet) throw new Error('sniper wallet not configured');
    const token20 = new Contract(token, ERC20_ABI, this.wallet);
    const bal = (await token20.getFunction('balanceOf')(this.wallet.address)) as bigint;
    if (bal <= 0n) throw new Error('no token balance to sell');
    const decimals = Number((await token20.getFunction('decimals')()) as bigint);

    await this.ensurePermit2(token, bal);

    // Quote token → WETH out.
    const pk = poolKey(token);
    const zeroForOne = !pk.wethIsCurrency0; // token → WETH
    let quotedOut = 0n;
    try {
      quotedOut = await this.quoteOut(token, bal, zeroForOne);
    } catch (err) {
      throw new Error(`sell quote reverted (${shortErr(err)})`);
    }
    const amountOutMin = this.minOut(quotedOut);
    const weth = getAddress(config.SNIPER_WETH);

    const actions = '0x' + ACT_SWAP_EXACT_IN_SINGLE + ACT_SETTLE_ALL + ACT_TAKE_ALL;
    const params = [
      this.encodeSwapParams(token, zeroForOne, bal, amountOutMin),
      abi.encode(['address', 'uint256'], [getAddress(token), bal]), // SETTLE_ALL(token, bal)
      abi.encode(['address', 'uint256'], [weth, amountOutMin]), // TAKE_ALL(WETH → router)
    ];
    const v4Input = abi.encode(['bytes', 'bytes[]'], [actions, params]);
    // Swap to WETH in the router, then unwrap to native ETH back to the wallet.
    const unwrapInput = abi.encode(['address', 'uint256'], [this.wallet.address, amountOutMin]);
    const commands = concat([CMD_V4_SWAP, CMD_UNWRAP_WETH]);

    const router = new Contract(config.SNIPER_ROUTER, ROUTER_ABI, this.wallet);
    const deadline = Math.floor(Date.now() / 1000) + 120;
    const tx = await router.getFunction('execute')(commands, [v4Input, unwrapInput], deadline);
    logger.info({ token, tx: tx.hash }, 'sniper: sell (take-profit) sent');
    await tx.wait(1);
    return {
      txHash: tx.hash,
      ethReceived: Number(formatEther(quotedOut)),
      tokensSold: Number(formatUnits(bal, decimals)),
    };
  }
}

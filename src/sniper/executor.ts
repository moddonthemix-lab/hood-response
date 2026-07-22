import {
  JsonRpcProvider,
  Wallet,
  Contract,
  parseEther,
  formatEther,
  formatUnits,
  MaxUint256,
} from 'ethers';
import { config } from '../config/env.js';
import { logger } from '../logger.js';

const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

export interface BuyResult {
  txHash: string;
  /** Human token amount received (best effort via balance diff). */
  tokensReceived: number;
  ethSpent: number;
}

export interface SellResult {
  txHash: string;
  /** Estimated ETH received (from the router quote). */
  ethReceived: number;
  tokensSold: number;
}

// Minimal typed views over the dynamic ethers Contract (whose methods are typed
// as possibly-undefined), so call sites stay type-checked.
interface TxResp {
  hash: string;
  wait(n?: number): Promise<unknown>;
}
interface RouterC {
  getAmountsOut(amountIn: bigint, path: string[]): Promise<bigint[]>;
  swapExactETHForTokensSupportingFeeOnTransferTokens(
    amountOutMin: bigint,
    path: string[],
    to: string,
    deadline: number,
    overrides: { value: bigint },
  ): Promise<TxResp>;
  swapExactTokensForETHSupportingFeeOnTransferTokens(
    amountIn: bigint,
    amountOutMin: bigint,
    path: string[],
    to: string,
    deadline: number,
  ): Promise<TxResp>;
}
interface Erc20C {
  balanceOf(owner: string): Promise<bigint>;
  decimals(): Promise<bigint>;
  allowance(owner: string, spender: string): Promise<bigint>;
  approve(spender: string, amount: bigint): Promise<TxResp>;
}
const asRouter = (c: Contract): RouterC => c as unknown as RouterC;
const asErc20 = (c: Contract): Erc20C => c as unknown as Erc20C;

/**
 * Executes ETH→token buys through a Uniswap-V2-style DEX router using a server
 * hot wallet. Constructed lazily so the app runs fine with no key configured;
 * `ready` is false until a private key, router and WETH address are all set.
 *
 * IMPORTANT: the router MUST be the verified Robinhood Chain DEX router. A wrong
 * address can lose funds. This assumes a V2-style router; a V3 DEX needs a
 * different swap call.
 */
export class SwapExecutor {
  private provider: JsonRpcProvider | null = null;
  private wallet: Wallet | null = null;
  private router: Contract | null = null;

  get ready(): boolean {
    return (
      config.SNIPER_PRIVATE_KEY.length > 0 &&
      config.SNIPER_ROUTER.length > 0 &&
      config.SNIPER_WETH.length > 0
    );
  }

  private init(): void {
    if (this.wallet || !this.ready) return;
    const rpc = config.CHAIN_HTTP_URL || 'https://rpc.mainnet.chain.robinhood.com';
    this.provider = new JsonRpcProvider(rpc);
    this.wallet = new Wallet(config.SNIPER_PRIVATE_KEY, this.provider);
    this.router = new Contract(config.SNIPER_ROUTER, ROUTER_ABI, this.wallet);
  }

  /** The hot wallet address (for display), or null if not configured. */
  address(): string | null {
    this.init();
    return this.wallet?.address ?? null;
  }

  /** Native (ETH) balance of the hot wallet, or null if unavailable. */
  async balanceEth(): Promise<number | null> {
    this.init();
    if (!this.wallet || !this.provider) return null;
    try {
      const wei = await this.provider.getBalance(this.wallet.address);
      return Number(formatEther(wei));
    } catch {
      return null;
    }
  }

  /**
   * Buy `ethAmount` worth of `token` through the router. Throws on any failure
   * (caller records the miss); never silently spends.
   */
  async buy(token: string, ethAmount: number): Promise<BuyResult> {
    this.init();
    if (!this.wallet || !this.router) throw new Error('sniper wallet not configured');
    const weth = config.SNIPER_WETH;
    const path = [weth, token];
    const amountIn = parseEther(ethAmount.toString());

    // Expected out from the router, minus slippage → amountOutMin.
    const router = asRouter(this.router);
    let amountOutMin = 0n;
    try {
      const amounts = await router.getAmountsOut(amountIn, path);
      const out = amounts[amounts.length - 1] ?? 0n;
      const bps = BigInt(Math.round((100 - config.SNIPER_SLIPPAGE_PCT) * 100));
      amountOutMin = (out * bps) / 10_000n;
    } catch (err) {
      throw new Error(`no route / getAmountsOut failed: ${String(err)}`);
    }

    const token20 = asErc20(new Contract(token, ERC20_ABI, this.wallet));
    const before = await token20.balanceOf(this.wallet.address);
    const deadline = Math.floor(Date.now() / 1000) + 120;

    const tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
      amountOutMin,
      path,
      this.wallet.address,
      deadline,
      { value: amountIn },
    );
    logger.info({ token, ethAmount, tx: tx.hash }, 'sniper: buy sent');
    await tx.wait(1);

    let tokensReceived = 0;
    try {
      const after = await token20.balanceOf(this.wallet.address);
      const decimals = Number(await token20.decimals());
      tokensReceived = Number(formatUnits(after - before, decimals));
    } catch {
      /* balance read failed — leave tokensReceived at 0, tx still succeeded */
    }
    return { txHash: tx.hash, tokensReceived, ethSpent: ethAmount };
  }

  /**
   * Sell the entire hot-wallet balance of `token` back to ETH (used by
   * take-profit). Approves the router once if needed. Throws on failure.
   */
  async sell(token: string): Promise<SellResult> {
    this.init();
    if (!this.wallet || !this.router) throw new Error('sniper wallet not configured');
    const weth = config.SNIPER_WETH;
    const router = asRouter(this.router);
    const token20 = asErc20(new Contract(token, ERC20_ABI, this.wallet));
    const bal = await token20.balanceOf(this.wallet.address);
    if (bal <= 0n) throw new Error('no token balance to sell');
    const decimals = Number(await token20.decimals());

    // Approve the router to spend the token if the allowance is short.
    const allowance = await token20.allowance(this.wallet.address, config.SNIPER_ROUTER);
    if (allowance < bal) {
      const approveTx = await token20.approve(config.SNIPER_ROUTER, MaxUint256);
      await approveTx.wait(1);
    }

    const path = [token, weth];
    let amountOutMin = 0n;
    let quotedOut = 0n;
    try {
      const amounts = await router.getAmountsOut(bal, path);
      quotedOut = amounts[amounts.length - 1] ?? 0n;
      const bps = BigInt(Math.round((100 - config.SNIPER_SLIPPAGE_PCT) * 100));
      amountOutMin = (quotedOut * bps) / 10_000n;
    } catch (err) {
      throw new Error(`no route / getAmountsOut failed: ${String(err)}`);
    }

    const deadline = Math.floor(Date.now() / 1000) + 120;
    const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
      bal,
      amountOutMin,
      path,
      this.wallet.address,
      deadline,
    );
    logger.info({ token, tx: tx.hash }, 'sniper: sell (take-profit) sent');
    await tx.wait(1);
    return {
      txHash: tx.hash,
      ethReceived: Number(formatEther(quotedOut)),
      tokensSold: Number(formatUnits(bal, decimals)),
    };
  }
}

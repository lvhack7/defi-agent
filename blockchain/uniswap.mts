import { createPublicClient, http, parseAbi, parseUnits, formatUnits, zeroAddress, type Address } from 'viem';
import { networkConfig, rpcFor, networkName } from './networks.mts';
import { analyzePortfolio } from './valuation.mts';

const FEES = [100, 500, 3000, 10000] as const;
const factoryAbi = parseAbi(['function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)']);
const quoterAbi = parseAbi(['function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)']);
export function isFullInputQuote(sqrtAfter: bigint): boolean {
  // Pool.swap stops on amountSpecifiedRemaining == 0 or the price limit.
  return sqrtAfter > 4295128740n && sqrtAfter < 1461446703485210103287273052203988822378723970341n;
}
type Asset = 'ETH' | 'USDC';
function amountRaw(value: unknown, decimals: number): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value) || value.length > 80 || (value.split('.')[1]?.length ?? 0) > decimals) throw new Error(`Invalid amount: use a positive decimal string with at most ${decimals} decimals`);
  const raw = parseUnits(value, decimals);
  if (raw <= 0n || raw >= 2n ** 256n) throw new Error('Invalid amount: outside supported range');
  return raw;
}
export async function quoteSwap(input: unknown, rpcOverride?: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be an object');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(k => !['tokenIn', 'amount', 'network'].includes(k))) throw new Error('Unknown input field');
  if (value.tokenIn !== 'ETH' && value.tokenIn !== 'USDC') throw new Error('Invalid tokenIn: choose ETH or USDC');
  const tokenIn: Asset = value.tokenIn;
  const tokenOut: Asset = tokenIn === 'ETH' ? 'USDC' : 'ETH';
  const raw = amountRaw(value.amount, tokenIn === 'ETH' ? 18 : 6);
  const config = networkConfig(value.network);
  const { factory: FACTORY, quoter: QUOTER, weth: WETH, usdc: USDC, chain } = config;
  const client = createPublicClient({ chain, transport: http(rpcFor(config.network, rpcOverride), { timeout: 10000, retryCount: 1 }) });
  if (await client.getChainId() !== chain.id) throw new Error(`RPC endpoint does not match ${chain.name}`);
  const blockNumber = await client.getBlockNumber();
  const addressIn = (tokenIn === 'ETH' ? WETH : USDC) as Address;
  const addressOut = (tokenIn === 'ETH' ? USDC : WETH) as Address;
  const pools = await Promise.all(FEES.map(async fee => ({ fee, pool: await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'getPool', args: [addressIn, addressOut, fee], blockNumber }) })));
  const existing = pools.filter(row => row.pool !== zeroAddress);
  if (!existing.length) return { status: 'no_pool', network: config.network, blockNumber: blockNumber.toString(), tokenIn, tokenOut, amountIn: value.amount, message: 'No direct Uniswap v3 WETH/USDC pool exists at the checked fee tiers.' };
  const attempts = await Promise.all(existing.map(async row => {
    try {
      const { result } = await client.simulateContract({ address: QUOTER, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ tokenIn: addressIn, tokenOut: addressOut, amountIn: raw, fee: row.fee, sqrtPriceLimitX96: 0n }], blockNumber });
      return { ...row, amountOut: result[0], gasEstimate: result[3], fullInputConsumed: isFullInputQuote(result[1]) };
    } catch { return { ...row, amountOut: 0n, gasEstimate: 0n, fullInputConsumed: false }; }
  }));
  const successful = attempts.filter(row => row.amountOut > 0n).sort((a, b) => a.amountOut > b.amountOut ? -1 : a.amountOut < b.amountOut ? 1 : 0);
  if (!successful.length) return { status: 'unavailable', network: config.network, blockNumber: blockNumber.toString(), tokenIn, tokenOut, amountIn: value.amount, poolsChecked: existing.length, message: 'Pools exist but no quote was returned; liquidity or RPC simulation may be unavailable.' };
  const best = successful[0];
  return { status: 'quoted', network: config.network, chainId: chain.id, blockNumber: blockNumber.toString(), quotedAt: new Date().toISOString(), protocol: 'Uniswap v3', route: 'single-hop WETH/USDC', tokenIn, tokenOut, amountIn: formatUnits(raw, tokenIn === 'ETH' ? 18 : 6), amountOut: formatUnits(best.amountOut, tokenOut === 'ETH' ? 18 : 6), pool: best.pool, fullInputConsumed: best.fullInputConsumed, feeTier: best.fee, feePercent: best.fee / 10000, quoterGasEstimate: best.gasEstimate.toString(), failedPoolQuotes: existing.length - successful.length, note: 'Indicative exact-input quote at the specified block, including pool fee. Gas estimate is not a transaction cost. A quote does not guarantee that all input can be consumed at the price limit. No slippage protection or execution is included. Other routes and fee tiers may exist.' };
}

export function planRebalance(ethValue: string, usdcValue: string, ethPrice: string, usdcPrice: string, targetEthPercent: number) {
  const eth = parseUnits(ethValue, 8), usdc = parseUnits(usdcValue, 8);
  const total = eth + usdc;
  if (total === 0n) return null;
  const target = BigInt(Math.round(targetEthPercent * 10000));
  const delta = eth - total * target / 1000000n;
  if (delta === 0n) return null;
  const tokenIn: Asset = delta > 0n ? 'ETH' : 'USDC';
  const price = parseUnits(delta > 0n ? ethPrice : usdcPrice, 8);
  if (price === 0n) throw new Error('Invalid price: too small for proposal precision');
  const decimals = tokenIn === 'ETH' ? 18 : 6;
  const amount = (delta > 0n ? delta : -delta) * 10n ** BigInt(decimals) / price;
  return amount > 0n ? { tokenIn, amount: formatUnits(amount, decimals) } : null;
}
export async function proposeRebalance(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be an object');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(k => !['wallet', 'targetEthPercent', 'network'].includes(k))) throw new Error('Unknown input field');
  if (typeof value.targetEthPercent !== 'number' || !Number.isFinite(value.targetEthPercent) || value.targetEthPercent < 0 || value.targetEthPercent > 100 || Math.abs(value.targetEthPercent * 10000 - Math.round(value.targetEthPercent * 10000)) > 1e-7) throw new Error('Invalid targetEthPercent: expected 0 to 100 with at most four decimal places');
  const analysis = await analyzePortfolio({ wallet: value.wallet, network: networkName(value.network), targetEthPercent: value.targetEthPercent });
  if (!analysis.valuation) return { analysis, proposal: null, message: 'A current valuation is required before proposing a trade.' };
  const [eth, usdc] = analysis.valuation.assets;
  const plan = planRebalance(eth.valueUsdc, usdc.valueUsdc, analysis.pricing!.usdcPerEth, '1', value.targetEthPercent);
  if (!plan) return { analysis, proposal: null, message: 'No nonzero rebalance amount could be calculated.' };
  const quote = await quoteSwap({ ...plan, network: networkName(value.network) });
  return { analysis, proposal: { ...plan, quote }, note: 'Indicative proposal. Size uses valuation prices and ignores swap fees, price impact and gas; it may not reach the target. No gas reserve, slippage protection, approval or transaction is included. Balance and quote may use different blocks.' };
}

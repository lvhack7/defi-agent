import { formatUnits, parseUnits } from 'viem';
import { quoteSwap } from './uniswap.mts';
import { getPricing, type Pricing } from './prices.mts';
import { networkName, type Network } from './networks.mts';
import { POLICY } from './policy.mts';

type Token = 'ETH' | 'USDC';
type QuoteSnapshot = {
  network: Network; chainId: number; tokenIn: Token; tokenOut: Token;
  amountIn: string; amountOut: string; quotedAt: string; blockNumber: string;
  feeTier: number; pool: string; fullInputConsumed: boolean;
};

export function swapCalculation(quote: QuoteSnapshot, slippageBps: number, pricing: Pricing | null) {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > POLICY.maxSlippageBps) throw new Error(`Invalid slippage: use 0–${POLICY.maxSlippageBps} basis points`);
  if (!quote.fullInputConsumed) throw new Error('Invalid quote: full input consumption was not confirmed');
  const inDecimals = quote.tokenIn === 'ETH' ? 18 : 6, outDecimals = quote.tokenOut === 'ETH' ? 18 : 6;
  const amountIn = parseUnits(quote.amountIn, inDecimals), amountOut = parseUnits(quote.amountOut, outDecimals);
  if (amountIn <= 0n || amountOut <= 0n || !Number.isFinite(Date.parse(quote.quotedAt))) throw new Error('Invalid quote amounts or timestamp');
  const minimum = amountOut * BigInt(10000 - slippageBps) / 10000n;
  const rate = amountOut * 10n ** BigInt(inDecimals) * 10n ** 18n / (amountIn * 10n ** BigInt(outDecimals));
  const fee = (amountIn * BigInt(quote.feeTier) + 999999n) / 1000000n;
  const usdValue = (raw: bigint, token: Token) => {
    const price = quote.network !== 'sepolia' && pricing?.currency === 'USD' ? token === 'ETH' ? pricing.ethUsd : pricing.usdcUsd : null;
    return price ? formatUnits(raw * parseUnits(price, 8) / 10n ** BigInt(token === 'ETH' ? 18 : 6), 8) : null;
  };
  return {
    status: 'quoted' as const, ...quote,
    minimumOut: formatUnits(minimum, outDecimals), slippageBps,
    rate: { amount: '1', tokenIn: quote.tokenIn, amountOut: formatUnits(rate, 18), tokenOut: quote.tokenOut },
    inputUsd: usdValue(amountIn, quote.tokenIn), outputUsd: usdValue(amountOut, quote.tokenOut),
    poolFee: { percent: quote.feeTier / 10000, estimatedAmount: formatUnits(fee, inDecimals), token: quote.tokenIn, includedInOutput: true },
    networkFee: { status: 'requires_validation' as const, message: 'Calculated for the exact transaction during wallet-based validation; not deducted from this output.' },
    expiresAt: Date.parse(quote.quotedAt) + POLICY.maxQuoteAgeMs,
    pricingSource: quote.network !== 'sepolia' && pricing?.currency === 'USD' ? pricing.source : null,
    pricingWarning: quote.network !== 'sepolia' && !pricing ? 'USD reference prices unavailable; output still uses the on-chain quote.' : null,
    note: 'Indicative Uniswap exact-input quote, including pool fees and price impact. Minimum output is rounded down. No approval, proposal or transaction is created. Review requires fresh validation.',
  };
}

export async function calculateSwap(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid swap calculation input');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['network', 'tokenIn', 'amount', 'slippageBps'].includes(key))) throw new Error('Unknown input field');
  if (value.network === undefined) throw new Error('Invalid network: choose a network');
  const network = networkName(value.network), slippage = value.slippageBps === undefined ? 50 : value.slippageBps;
  if (typeof slippage !== 'number' || !Number.isInteger(slippage) || slippage < 0 || slippage > POLICY.maxSlippageBps) throw new Error('Invalid slippage basis points');
  if (value.tokenIn !== 'ETH' && value.tokenIn !== 'USDC') throw new Error('Invalid token: choose ETH or USDC');
  const decimals = value.tokenIn === 'ETH' ? 18 : 6;
  if (typeof value.amount !== 'string' || value.amount.length > 80 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value.amount) || (value.amount.split('.')[1]?.length ?? 0) > decimals) throw new Error('Invalid token amount');
  const raw = parseUnits(value.amount, decimals);
  if (raw <= 0n || raw >= 2n ** 256n) throw new Error('Invalid token amount');
  const [quote, pricing] = await Promise.all([
    quoteSwap({ network, tokenIn: value.tokenIn, amount: value.amount }),
    network === 'sepolia' ? Promise.resolve(null) : getPricing(network).catch(() => null),
  ]);
  if (quote.status !== 'quoted' || quote.amountOut === undefined || quote.feeTier === undefined || !quote.quotedAt || !quote.pool || !quote.fullInputConsumed) {
    return { status: 'unavailable' as const, network, message: quote.message ?? 'A quote consuming the full input is unavailable. Try another amount.' };
  }
  return swapCalculation({ network, chainId: quote.chainId!, tokenIn: quote.tokenIn, tokenOut: quote.tokenOut, amountIn: quote.amountIn as string, amountOut: quote.amountOut, quotedAt: quote.quotedAt, blockNumber: quote.blockNumber, feeTier: quote.feeTier, pool: quote.pool, fullInputConsumed: true }, slippage, pricing);
}

import { formatUnits, parseUnits } from 'viem';
import { getPortfolio, validateInput } from './portfolio.mts';
import { getPricing } from './prices.mts';
import { networkName } from './networks.mts';
type Balances = { ETH: { rawBalance: string; decimals: number }; USDC: { rawBalance: string; decimals: number } };
export function calculateAllocation(balances: Balances, usdcPerEth: string, targetEthPercent?: number, usdcUsd = '1', currency = 'test USDC') {
  const price = parseUnits(usdcPerEth, 8);
  if (price <= 0n) throw new Error('Invalid pool price');
  const values = [BigInt(balances.ETH.rawBalance) * price / 10n ** BigInt(balances.ETH.decimals), BigInt(balances.USDC.rawBalance) * 100000000n / 10n ** BigInt(balances.USDC.decimals)];
  const total = values[0] + values[1];
  return { currency, total: formatUnits(total * parseUnits(usdcUsd, 8) / 100000000n, 8), assets: (['ETH', 'USDC'] as const).map((asset, index) => {
    const percent = total === 0n ? null : Number(values[index] * 1_000_000n / total) / 10000;
    const target = targetEthPercent === undefined ? undefined : index === 0 ? targetEthPercent : 100 - targetEthPercent;
    return { asset, valueUsdc: formatUnits(values[index], 8), valueUsd: currency === 'USD' ? formatUnits(values[index] * parseUnits(usdcUsd, 8) / 100000000n, 8) : null, allocationPercent: percent, ...(target !== undefined ? { targetPercent: target, driftPercentagePoints: percent === null ? null : Math.round((percent - target) * 10000) / 10000 } : {}) };
  }), precision: 'Test USDC values truncated to 8 decimal places; percentages truncated to 4 decimal places' };
}
export async function analyzePortfolio(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be an object');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(k => !['wallet', 'network', 'targetEthPercent'].includes(k))) throw new Error('Unknown input field');
  const network = networkName(value.network);
  if (value.targetEthPercent !== undefined && (typeof value.targetEthPercent !== 'number' || !Number.isFinite(value.targetEthPercent) || value.targetEthPercent < 0 || value.targetEthPercent > 100)) throw new Error('Invalid targetEthPercent: expected a number from 0 to 100');
  validateInput({ wallet: value.wallet, network: value.network });
  // Independent reads start together. Capture price errors immediately so a slow
  // balance request cannot cause an unhandled price rejection.
  const pricingRead = getPricing(network).then(pricing => ({ pricing }), () => ({ pricing: null }));
  const portfolio = await getPortfolio({ wallet: value.wallet, network, includeUsdc: true });
  const token = portfolio.tokens[0];
  const basis = network !== 'sepolia' ? 'Indicative USD valuation from CoinGecko ETH/USD and USDC/USD. Only ETH and native Circle USDC included; swaps use on-chain Uniswap quotes.' : 'Sepolia testnet spot price, denominated in test USDC. Test tokens have no real-world value; spot price can be manipulated. Only ETH and Circle USDC are included.';
  if (!token || token.error || token.rawBalance === undefined || token.decimals === undefined) return { portfolio, basis, valuation: null, valuationError: 'USDC balance unavailable; allocation cannot be calculated.' };
  try {
    const { pricing } = await pricingRead;
    if (!pricing) throw new Error('Pricing unavailable');
    return { portfolio, basis, pricing, spot: network === 'sepolia' ? pricing : undefined, valuation: calculateAllocation({ ETH: portfolio.native, USDC: { rawBalance: token.rawBalance, decimals: token.decimals } }, pricing.usdcPerEth, value.targetEthPercent as number | undefined, pricing.usdcUsd ?? '1', pricing.currency) };
  } catch { return { portfolio, basis, valuation: null, valuationError: network !== 'sepolia' ? 'CoinGecko prices unavailable or stale; allocation cannot be calculated.' : 'Sepolia pool price unavailable; allocation cannot be calculated.' }; }
}

import { parseUnits, formatUnits } from 'viem';
import { validateTrade } from './trade-validation.mts';
import type { ReviewedTerms } from './trade-validation.mts';
export { POLICY } from './policy.mts';
type Snapshot = { ethRaw: bigint; usdcRaw: bigint; usdcPerEth: string };
export function assessEconomics(snapshot: Snapshot, amountIn: bigint, amountOut: bigint, minimumOut: bigint) {
  const { ethRaw, usdcRaw, usdcPerEth } = snapshot;
  const ep = parseUnits(usdcPerEth, 8), up = 100000000n;
  if (amountIn <= 0n || amountOut <= 0n || minimumOut <= 0n || ep <= 0n || up <= 0n || ethRaw < amountIn) throw new Error('Invalid swap amounts, price or balance');
  // Compare quoted test USDC per ETH with the Sepolia pool spot price.
  const impliedPriceScaled = amountOut * up * 10n ** 18n / (amountIn * 10n ** 6n);
  const deviationNumerator = (impliedPriceScaled > ep ? impliedPriceScaled - ep : ep - impliedPriceScaled) * 10000n;
  const deviationBps = Number((deviationNumerator + ep - 1n) / ep);
  function allocation(received: bigint) {
    const ethValue = (ethRaw - amountIn) * ep / 10n ** 18n;
    const usdcValue = (usdcRaw + received) * up / 10n ** 6n;
    const total = ethValue + usdcValue;
    if (total === 0n) throw new Error('Invalid zero post-swap portfolio');
    return Number(ethValue * 1_000_000n / total) / 10000;
  }
  const quotedEthPercent = allocation(amountOut), minimumEthPercent = allocation(minimumOut);
  return { impliedUsdcPerEth: formatUnits(impliedPriceScaled, 8), deviationPercent: deviationBps / 100, quotedEthPercent, quotedUsdcPercent: 100 - quotedEthPercent, minimumEthPercent, minimumUsdcPercent: 100 - minimumEthPercent };
}

export const validateSwap = (input: unknown, reviewed?: ReviewedTerms) => validateTrade(input, false, reviewed);

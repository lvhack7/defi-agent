import { parseUnits } from 'viem';
import { executionEnabled, type Network } from './networks.mts';
export const POLICY = { maxDeviationPercent: 5, maxSlippageBps: 100, maxQuoteAgeMs: 30000, maxQuoteBlocks: 3n, minGasReserveWei: 5_000_000_000_000_000n, deadlineSeconds: 300, maxProposalAgeMs: 300000 } as const;
function positiveDecimal(key: string, fallback: string): string {
  const value = process.env[key] ?? fallback;
  if (!/^(0|[1-9]\d*)(\.\d{1,8})?$/.test(value) || parseUnits(value, 8) <= 0n) throw new Error(`Invalid policy setting ${key}`);
  return value;
}
export function policyFor(network: Network) {
  return { ...POLICY, minGasReserveWei: network === 'base' ? 100_000_000_000_000n : POLICY.minGasReserveWei,
    maxQuoteBlocks: network === 'base' ? 15n : POLICY.maxQuoteBlocks,
    maxTradeUsd: positiveDecimal('MAX_TRADE_USD', '100'), maxGasUsd: positiveDecimal('MAX_GAS_USD', '5'), executionEnabled: executionEnabled(network) };
}

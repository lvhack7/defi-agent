import { normalizedAmount, validSwapAmount, type SwapRequest } from './swap-preview.ts'

export type UsdcAllowance = { network: SwapRequest['network']; chainId: number; wallet: string; rawAllowance: string; allowance: string }
export function hasUsdcAllowance(rawAllowance: string, amount: string) {
  if (!/^\d+$/.test(rawAllowance) || !validSwapAmount(amount, 'USDC')) return false
  const [whole, fraction = ''] = normalizedAmount(amount).split('.')
  return BigInt(rawAllowance) >= BigInt(whole + fraction.padEnd(6, '0'))
}
export async function fetchUsdcAllowance(network: SwapRequest['network'], wallet: string, signal: AbortSignal): Promise<UsdcAllowance> {
  const response = await fetch('/api/usdc-allowance', { method: 'POST', headers: { 'content-type': 'application/json', 'x-defi-ui': '1' }, body: JSON.stringify({ network, wallet }), signal })
  const result = await response.json()
  if (!response.ok) throw new Error('Could not check USDC approval. Review will check again.')
  if (result.network !== network || result.chainId !== { base: 8453, mainnet: 1, sepolia: 11155111 }[network] || typeof result.wallet !== 'string' || result.wallet.toLowerCase() !== wallet.toLowerCase() || typeof result.rawAllowance !== 'string' || !/^\d{1,78}$/.test(result.rawAllowance) || BigInt(result.rawAllowance) >= 2n ** 256n) throw new Error('USDC approval response does not match this wallet and network.')
  return result
}

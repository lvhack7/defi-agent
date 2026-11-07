export type SwapToken = 'ETH' | 'USDC'
export type SwapRequest = { network: 'base' | 'mainnet' | 'sepolia'; tokenIn: SwapToken; amount: string; slippageBps: number }
export type SwapPreview = {
  status: 'quoted'; network: SwapRequest['network']; chainId: number; tokenIn: SwapToken; tokenOut: SwapToken;
  amountIn: string; amountOut: string; minimumOut: string; slippageBps: number; expiresAt: number; quotedAt: string;
  inputUsd: string | null; outputUsd: string | null; pricingWarning: string | null;
  rate: { amountOut: string }; poolFee: { percent: number; estimatedAmount: string; token: SwapToken; includedInOutput: boolean };
}
export type SwapPreviewResult = SwapPreview | { status: 'unavailable'; network: SwapRequest['network']; message: string }

export function normalizedAmount(value: string) {
  const amount = value.trim()
  return amount.startsWith('.') ? '0' + amount : amount
}

export function validSwapAmount(value: string, token: SwapToken) {
  const amount = normalizedAmount(value), decimals = token === 'ETH' ? 18 : 6
  if (amount.length > 80 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(amount)) return false
  const [whole, fraction = ''] = amount.split('.')
  if (fraction.length > decimals) return false
  const raw = BigInt(whole + fraction.padEnd(decimals, '0'))
  return raw > 0n && raw < 2n ** 256n
}

export function swapRequestKey(input: SwapRequest) {
  return JSON.stringify([input.network, input.tokenIn, normalizedAmount(input.amount), input.slippageBps])
}

export function usableSwapPreview(snapshot: { key: string; result?: SwapPreviewResult } | undefined, input: SwapRequest, now: number) {
  if (snapshot?.key !== swapRequestKey(input) || snapshot.result?.status !== 'quoted' || !Number.isFinite(snapshot.result.expiresAt) || now >= snapshot.result.expiresAt) return null
  return snapshot.result
}

// Truncate display digits; exact decimal strings are retained for validation.
export function formatSwapAmount(value: string, token: SwapToken) {
  const digits = token === 'ETH' ? 8 : 6
  const [whole, fraction = ''] = value.split('.')
  const truncated = fraction.slice(0, digits).replace(/0+$/, '')
  if (BigInt(whole) === 0n && !/[1-9]/.test(truncated) && /[1-9]/.test(fraction)) return '<0.' + '0'.repeat(digits - 1) + '1'
  return BigInt(whole).toLocaleString('en-US') + (truncated ? '.' + truncated : '')
}

export async function fetchSwapPreview(input: SwapRequest, signal: AbortSignal): Promise<SwapPreviewResult> {
  const response = await fetch('/api/swap-preview', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-defi-ui': '1' },
    body: JSON.stringify({ ...input, amount: normalizedAmount(input.amount) }), signal,
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? 'Could not calculate this swap.')
  if (result.network !== input.network || (result.status === 'quoted' && result.tokenIn !== input.tokenIn)) throw new Error('Quote does not match the selected network or token.')
  return result
}

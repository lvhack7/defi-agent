export type Trade = {
  input?: { network?: 'base' | 'mainnet' | 'sepolia'; wallet?: string; amountUsdc?: string }
  id: string; status: string; hash?: string
  validation: {
    executionEnabled?: boolean; network?: string; transaction?: { chainId: number }
    checks: { name: string; passed: boolean; explanation: string }[]; message: string
    economics?: { quotedEthPercent: number; quotedUsdcPercent: number }
    quote?: { amountIn: string; amountOut: string; tokenIn: string; tokenOut: string }
    minimumOut?: string; gasEstimate?: { totalBudgetEth: string; totalBudgetUsd: string | null }; kind?: string
  }
  result?: {
    inputVerified?: boolean; outputVerified?: boolean; balancesVerified?: boolean; confirmations?: number; blockNumber?: string
    portfolio?: { native: { balance: string }; tokens: { balance?: string }[] }
    usdcReceivedRaw: string; receiptStatus: string
  }
}

export type ProgressReporter = (stage: string) => void;

export function toolStage(name?: string): string {
  if (name === 'calculate_swap') return 'Calculating swap output';
  if (name === 'get_portfolio') return 'Reading wallet balances';
  if (name === 'analyze_portfolio') return 'Reading balances and prices';
  if (name?.includes('quote') || name?.includes('rebalance')) return 'Fetching Uniswap quotes';
  if (name?.includes('validate')) return 'Validating swap';
  if (name?.includes('prepare')) return 'Preparing swap proposal';
  if (name === 'get_trade_status') return 'Checking transaction status';
  return 'Running agent tool';
}

export const responseTimeoutMessage = 'The agent response timed out. It may still be running. Check existing proposals before requesting another swap.';

export function checkResponseDeadline(signal: AbortSignal) {
  if (signal.aborted) throw new Error(responseTimeoutMessage);
}

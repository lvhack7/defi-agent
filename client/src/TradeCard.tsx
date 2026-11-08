import type { Trade } from './trade'

type Props = {
  trade: Trade; busy: boolean; connected: string; canSign: boolean; explorer: string; walletDeadlineSeconds: number; pendingHash?: string
  onSign: () => void; onRefresh: () => void; onContinue: () => void; onVerify: () => void; onHashChange: (hash: string) => void
}
const number = (value: string, decimals: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals }).format(Number(value))

export function TradeCard({ trade, busy, connected, canSign, explorer, walletDeadlineSeconds, pendingHash, onSign, onRefresh, onContinue, onVerify, onHashChange }: Props) {
  const approval = trade.validation.kind === 'usdc_approval'
  const quote = trade.validation.quote
  const ownWallet = !!connected && trade.input?.wallet?.toLowerCase() === connected.toLowerCase()
  return <div className="trade" id={'trade-' + trade.id} tabIndex={-1}>
    <div className="panel-title"><h3>{quote ? approval ? `Approve ${quote.amountIn} USDC allowance` : `${quote.amountIn} ${quote.tokenIn} → ${quote.amountOut} ${quote.tokenOut}` : 'Swap proposal'}</h3><span className={'badge ' + trade.status}>{approval && trade.status === 'confirmed' ? 'Approval confirmed' : trade.status.replaceAll('_', ' ')}</span></div>
    <p className="muted">{trade.id.slice(0, 12)}{!approval && ` · Minimum output ${trade.validation.minimumOut ?? '—'} ${quote?.tokenOut ?? 'USDC'}`}</p>
    {approval && <p className="approval-explanation">Step 1 · USDC spending permission only. A separate swap is needed to receive ETH.</p>}
    {trade.status === 'rejected' && <p className="fail" role="status">{trade.validation.message}</p>}
    {trade.validation.gasEstimate && <p className="muted" title={trade.validation.gasEstimate.totalBudgetEth + ' ETH'}>Network fee budget {number(trade.validation.gasEstimate.totalBudgetEth, 10)} ETH{trade.validation.gasEstimate.totalBudgetUsd ? ' · ≈ $' + number(trade.validation.gasEstimate.totalBudgetUsd, 6) : ''}</p>}
    {!approval && trade.validation.economics && <p>Expected allocation {trade.validation.economics.quotedEthPercent}% ETH / {trade.validation.economics.quotedUsdcPercent}% USDC</p>}
    <details><summary>Validation checks</summary>{trade.validation.checks.map((check, i) => <p key={i} className={check.passed ? 'pass' : 'fail'}>{check.passed ? '✓' : '×'} {check.name}: {check.explanation}</p>)}</details>
    {trade.status === 'prepared' && !trade.validation.executionEnabled && <p className="muted">Validated · trading locked</p>}
    {trade.result && <details><summary>{approval ? 'Approval verification' : 'On-chain verification'} · {trade.result.confirmations ?? 0} confirmations</summary><p>Receipt: {trade.result.receiptStatus} · Block {trade.result.blockNumber ?? '—'}</p>{!approval && <p>Swap input {trade.result.inputVerified ? 'verified' : 'unverified'} · Output {trade.result.outputVerified ? 'verified' : 'unverified'} · Balances {trade.result.balancesVerified ? 'verified' : 'pending'}</p>}{trade.result.portfolio && <p>After transaction block: {trade.result.portfolio.native.balance} ETH / {trade.result.portfolio.tokens[0]?.balance ?? 'unavailable'} USDC</p>}</details>}
    {approval && trade.status === 'confirmed' && <div className="approval-next-step"><p>Approval confirmed. Continue to review the swap; it needs its own wallet confirmation.</p><button disabled={busy || !ownWallet} onClick={onContinue}>Review {quote?.amountIn ?? trade.input?.amountUsdc} USDC → ETH swap</button></div>}
    {trade.status === 'prepared' && <><p className="muted">{approval ? 'This approves the specified USDC amount only. It does not perform the swap.' : `A fresh quote is checked before signing. Your minimum received stays fixed. Confirm in Trust Wallet within ${Math.round(walletDeadlineSeconds / 60)} minutes.`}</p><div className="trade-actions"><button disabled={busy || !canSign || !ownWallet || !trade.validation.executionEnabled} onClick={onSign}>{approval ? 'Approve USDC in Trust Wallet' : 'Review & sign in Trust Wallet'}</button><button className="secondary" disabled={busy || !ownWallet} onClick={onRefresh}>Refresh quote</button></div></>}
    {trade.status === 'awaiting_wallet' && !pendingHash && <p className="muted">Inspect Trust Wallet for a pending or submitted transaction. If submitted, paste its hash to recover tracking.</p>}
    {['awaiting_wallet', 'submitted', 'verification_pending', 'verification_failed'].includes(trade.status) && <form onSubmit={event => { event.preventDefault(); onVerify() }}><input aria-label="Transaction hash" placeholder="0x transaction hash" value={pendingHash ?? trade.hash ?? ''} onChange={event => onHashChange(event.target.value)}/><button disabled={busy}>Verify receipt</button></form>}
    {trade.hash && <a target="_blank" rel="noreferrer" href={`${explorer}/tx/${trade.hash}`}>View {approval ? 'approval' : 'transaction'} ↗</a>}
  </div>
}

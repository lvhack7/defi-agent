import { useEffect, useId, useState } from 'react'
import { TokenIcon } from './TokenIcon'
import { Icon } from './Icon'
import { fetchSwapPreview, formatSwapAmount, normalizedAmount, swapRequestKey, usableSwapPreview, validSwapAmount, type SwapRequest, type SwapPreviewResult, type SwapToken } from './swap-preview'

type Props = {
  network: SwapRequest['network']; wallet: string; busy: boolean;
  onReview: (input: SwapRequest) => void; onApproval: (input: SwapRequest) => void;
}
const usd = (value: string | null | undefined) => value == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value))

export function SwapCalculator({ network, wallet, busy, onReview, onApproval }: Props) {
  const id = useId()
  const [tokenIn, setTokenIn] = useState<SwapToken>('ETH')
  const [amount, setAmount] = useState('0.001')
  const [slippageBps, setSlippage] = useState(50)
  const [refresh, setRefresh] = useState(0)
  const [now, setNow] = useState(Date.now)
  const [state, setState] = useState<{ key: string; loading: boolean; result?: SwapPreviewResult; error?: string }>()
  const input: SwapRequest = { network, tokenIn, amount, slippageBps }
  const key = swapRequestKey(input)
  const valid = validSwapAmount(amount, tokenIn) && Number.isInteger(slippageBps) && slippageBps >= 0 && slippageBps <= 100
  const matching = state?.key === key ? state : undefined
  const result = matching?.result?.status === 'quoted' ? matching.result : undefined
  const usable = usableSwapPreview(state, input, now)
  const loading = valid && (!matching || matching.loading)
  const tokenOut: SwapToken = tokenIn === 'ETH' ? 'USDC' : 'ETH'

  useEffect(() => {
    if (!valid) return
    let active = true
    const controller = new AbortController()
    setState({ key, loading: true })
    const timer = setTimeout(async () => {
      try {
        const result = await fetchSwapPreview({ network, tokenIn, amount, slippageBps }, AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]))
        if (active) { setState({ key, loading: false, result }); setNow(Date.now()) }
      } catch (error) {
        if (active) setState({ key, loading: false, error: error instanceof Error && error.name === 'TimeoutError' ? 'Quote request timed out. Refresh to try again.' : error instanceof Error ? error.message : 'Quote unavailable.' })
      }
    }, 500)
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [key, valid, refresh, network, tokenIn, amount, slippageBps])

  const expiresAt = result?.expiresAt
  useEffect(() => {
    if (!expiresAt) return
    const timer = setInterval(() => {
      const time = Date.now(); setNow(time)
      if (time >= expiresAt) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [expiresAt])

  function reverseDirection() {
    setTokenIn(tokenOut)
    setAmount(usable?.amountOut ?? '')
  }

  return <div className="swap-calculator">
    <div className="swap-quote-header"><span>Uniswap V3</span><button type="button" className="secondary quote-refresh" aria-label="Refresh swap quote" disabled={busy || loading || !valid} onClick={() => { setState({ key, loading: true }); setRefresh(value => value + 1) }}><Icon name="refresh"/></button></div>
    <form className="swap-calculator-form" onSubmit={event => { event.preventDefault(); if (usable && wallet && !busy) onReview({ ...input, amount: normalizedAmount(amount) }) }}>
      <div className="swap-asset-box">
        <label htmlFor={id + '-amount'}>You pay</label>
        <div className="swap-asset-row"><input id={id + '-amount'} aria-label="Swap input amount" inputMode="decimal" autoComplete="off" value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} placeholder="0.00"/><div className="swap-token-picker"><TokenIcon token={tokenIn}/><select aria-label="Swap input token" value={tokenIn} disabled={busy} onChange={event => { setTokenIn(event.target.value as SwapToken); setAmount('') }}><option>ETH</option><option>USDC</option></select></div></div>
        <span className="swap-usd">{network === 'sepolia' ? 'Testnet' : usd(result?.inputUsd)}</span>
      </div>
      <button type="button" className="swap-direction secondary" aria-label="Reverse swap direction" disabled={busy} onClick={reverseDirection}><Icon name="swap"/></button>
      <div className="swap-asset-box receive-box">
        <span className="swap-field-label">Estimated receive</span>
        <div className="swap-asset-row"><output aria-live="polite" title={result?.amountOut}>{loading ? 'Calculating…' : result ? formatSwapAmount(result.amountOut, tokenOut) : '—'}</output><div className="swap-token-output"><TokenIcon token={tokenOut}/><b>{tokenOut}</b></div></div>
        <span className="swap-usd">{network === 'sepolia' ? 'Testnet' : usd(result?.outputUsd)}</span>
      </div>
      <div className="swap-settings"><label htmlFor={id + '-slippage'}>Slippage (bps)</label><input id={id + '-slippage'} type="number" min="0" max="100" step="1" value={slippageBps} disabled={busy} onChange={event => setSlippage(Number(event.target.value))}/><span>{slippageBps / 100}%</span></div>
      {result && <>
        <dl className="swap-breakdown">
          <div><dt>Rate</dt><dd title={result.rate.amountOut}>1 {tokenIn} ≈ {formatSwapAmount(result.rate.amountOut, tokenOut)} {tokenOut}</dd></div>
          <div><dt>Minimum received</dt><dd title={result.minimumOut}>{formatSwapAmount(result.minimumOut, tokenOut)} {tokenOut}</dd></div>
          <div><dt>Pool fee</dt><dd title={`Approx. ${result.poolFee.estimatedAmount} ${tokenIn}`}>{result.poolFee.percent}% · included</dd></div>
          <div><dt>Network fee</dt><dd>Calculated on review</dd></div>
        </dl>
        <div className={'swap-freshness' + (!usable ? ' expired' : '')}>{usable ? `Quote expires in ${Math.max(0, Math.ceil((result.expiresAt - now) / 1000))}s` : 'Quote expired · refresh to recalculate'}</div>
        {result.pricingWarning && <p className="muted">{result.pricingWarning}</p>}
      </>}
      {!valid && <p className="swap-hint">Enter a positive {tokenIn} amount and slippage between 0 and 100 bps.</p>}
      {(matching?.error || matching?.result?.status === 'unavailable') && <p className="swap-hint fail" role="alert">{matching.error ?? (matching.result?.status === 'unavailable' ? matching.result.message : '')}</p>}
      <button className="swap-review" disabled={busy || !usable || !wallet}>{busy ? 'Working…' : !wallet ? 'Connect wallet to review' : 'Review swap'}</button>
      {tokenIn === 'USDC' && <button type="button" className="secondary swap-allowance" disabled={busy || !usable || !wallet} onClick={() => onApproval({ ...input, amount: normalizedAmount(amount) })}>Prepare USDC approval</button>}
    </form>
  </div>
}

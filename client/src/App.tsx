import { useEffect, useState } from 'react'
import './App.css'
import { Icon } from './Icon'
import { TokenIcon } from './TokenIcon'
import { dashboardContext } from './chat-context'
import { AgentResponse } from './AgentResponse'
import { SwapCalculator } from './SwapCalculator'

import { extensionProvider, mobileProvider, type WalletProvider } from './wallet'
import { supportsSigning, describeWalletPermissions, requestNetworkAccess, pairForNetwork } from './wallet-session'

type Network = 'base' | 'mainnet' | 'sepolia'
const networks = {base:{id:8453,name:'Base Mainnet',explorer:'https://basescan.org'},mainnet:{id:1,name:'Ethereum Mainnet',explorer:'https://etherscan.io'},sepolia:{id:11155111,name:'Ethereum Sepolia',explorer:'https://sepolia.etherscan.io'}}
type Check = { name: string; passed: boolean; explanation: string }
type Trade = { input?: {network?: Network}; id: string; status: string; hash?: string; validation: { executionEnabled?: boolean; network?: Network; transaction?: {chainId:number}; checks: Check[]; message: string; economics?: {quotedEthPercent: number; quotedUsdcPercent: number}; quote?: {amountIn: string; amountOut: string; tokenIn: string; tokenOut: string}; minimumOut?: string; kind?: string }; result?: {inputVerified?:boolean;outputVerified?:boolean;balancesVerified?:boolean;confirmations?:number;blockNumber?:string;portfolio?:{native:{balance:string};tokens:{balance?:string}[]};usdcReceivedRaw: string; receiptStatus: string} }
type Portfolio = { pricing?: {source:string;currency:string;ethUsd:string|null;usdcUsd:string|null;usdcPerEth:string;observedAt:string}; portfolio: {native: {balance: string}; tokens: {balance?: string; error?: string}[]}; valuation?: {currency:string;total: string; assets: {asset: string; allocationPercent: number|null; valueUsdc: string}[]}; valuationError?: string; spot?: {usdcPerEth: string; feeTier: number; blockNumber: string; pool: string} }
// Display formatting only; transaction amounts retain their original precision.
function displayNumber(value: string | null | undefined, decimals = 2) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals }).format(Number(value))
}
async function api(path: string, body?: unknown) {
  const response = await fetch('/api/' + path, body === undefined ? undefined : {method: 'POST', headers: {'content-type':'application/json', 'x-defi-ui':'1'}, body: JSON.stringify(body)})
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'Request failed')
  return data
}
function App() {
  const [network, setNetwork] = useState<Network>('base')
  const chainId = networks[network].id
  const [config, setConfig] = useState<{network:Network;executionEnabled:boolean;rpcConfigured:boolean;maxTradeUsd:string;maxGasUsd:string}[]>([])
  const activeConfig = config.find(c=>c.network===network)
  const [wallet, setWallet] = useState('')
  const [connected, setConnected] = useState('')
  const [provider, setProvider] = useState<WalletProvider>()
  const [connectionKind, setConnectionKind] = useState('')
  const [networkSigning, setNetworkSigning] = useState(false)
  const [portfolio, setPortfolio] = useState<Portfolio>()
  const [trades, setTrades] = useState<Trade[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [conversation, setConversation] = useState<{role: string; text: string}[]>([])
  const [activity, setActivity] = useState<string[]>([])
  const [chatProgress, setChatProgress] = useState({stage:'Connecting to agent', elapsedSeconds:0})
  const [hashes, setHashes] = useState<Record<string,string>>(() => JSON.parse(localStorage.getItem('defi-pending-hashes') ?? '{}'))
  const refreshTrades = async () => setTrades(await api('trades'))
  useEffect(() => { refreshTrades().catch(() => {}); api('config').then(setConfig).catch(()=>{}) }, [])
  useEffect(()=>{setPortfolio(undefined);setNetworkSigning(connectionKind === 'extension' || supportsSigning(provider?.session, chainId))},[network,chainId,provider,connectionKind])
  async function run(fn: () => Promise<void>) { setBusy(true); setError(''); try { await fn() } catch(e) { setError(e instanceof Error ? e.message : 'Action failed') } finally { setBusy(false) } }
  useEffect(() => {
    if (!provider) return
    const accountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[]
      setConnected(accounts?.[0] ?? '')
      setWallet(accounts?.[0] ?? '')
    }
    const chainChanged = (...args: unknown[]) => {
      if (Number(args[0]) !== chainId) setError('Wallet network changed. Switch to the selected network before signing.')
    }
    const sessionUpdated = () => setNetworkSigning(supportsSigning(provider.session, chainId))
    const disconnected = () => { setConnected(''); setWallet(''); setProvider(undefined); setConnectionKind(''); setNetworkSigning(false) }
    provider.on?.('accountsChanged', accountsChanged)
    provider.on?.('chainChanged', chainChanged)
    provider.on?.('disconnect', disconnected)
    provider.on?.('session_update', sessionUpdated)
    return () => {
      provider.removeListener?.('accountsChanged', accountsChanged)
      provider.removeListener?.('chainChanged', chainChanged)
      provider.removeListener?.('disconnect', disconnected)
      provider.removeListener?.('session_update', sessionUpdated)
    }
  }, [provider,chainId])
  async function connect(kind: 'extension' | 'mobile') {
    let selected: WalletProvider
    if (kind === 'mobile') {
      const wc = await mobileProvider(chainId)
      await pairForNetwork(wc, chainId)
      selected = wc as WalletProvider
    } else selected = extensionProvider()
    const provider = selected
    const supported = kind === 'extension' || supportsSigning(provider.session, chainId)
    const available = await provider.request({method: kind === 'extension' ? 'eth_requestAccounts' : 'eth_accounts'}) as string[]
    if (!available[0]) throw new Error('Wallet connection returned no account')
    setProvider(selected); setConnectionKind(kind); setConnected(available[0]); setWallet(available[0]); setNetworkSigning(supported)
    if (!supported) {
      setError(`Wallet connected without ${networks[network].name} signing permission. ${describeWalletPermissions(provider.session)} Viewing is available; trading requires an account on the selected network plus eth_sendTransaction. Changing the app's RPC URL cannot grant these permissions.`)
      return
    }
    const chain = await provider.request({method: 'eth_chainId'})
    if (Number(chain) !== chainId) await provider.request({method:'wallet_switchEthereumChain', params:[{chainId:`0x${chainId.toString(16)}`}]})
    if (Number(await provider.request({method:'eth_chainId'})) !== chainId) throw new Error('Select the requested network in Trust Wallet')
  }
  async function approve(trade: Trade) {
    if (!provider) throw new Error('Connect a wallet before signing')
    const targetChain = trade.validation.transaction?.chainId
    if (targetChain !== chainId) throw new Error('Proposal network differs from selected network')
    if (!activeConfig?.executionEnabled || !trade.validation.executionEnabled) throw new Error('Execution is locked for this network')
    if (connectionKind === 'mobile' && !supportsSigning(provider.session, chainId)) throw new Error('This mobile session does not authorize the selected network.')
    const accounts = await provider.request({method:'eth_accounts'}) as string[]
    if (!accounts[0] || accounts[0].toLowerCase() !== connected.toLowerCase()) throw new Error('Reconnect the intended Trust Wallet account')
    const chain = await provider.request({method:'eth_chainId'})
    if (Number(chain) !== chainId) await provider.request({method:'wallet_switchEthereumChain', params:[{chainId:`0x${chainId.toString(16)}`}]})
    if (Number(await provider.request({method:'eth_chainId'})) !== chainId) throw new Error('Wallet must be on the selected network')
    const {expiresAt, chainId: preparedChainId, ...tx} = await api('signature', {id: trade.id, wallet: connected})
    if (preparedChainId !== chainId || Date.now() >= expiresAt) throw new Error('Transaction expired or wrong network')
    let hash: string
    try { hash = await provider.request({method:'eth_sendTransaction', params:[{...tx, chainId:`0x${chainId.toString(16)}`}]}) as string }
    catch(e) {
      if ((e as {code?: number}).code === 4001) await api('decline', {id: trade.id})
      await refreshTrades()
      throw new Error((e as {code?: number}).code === 4001 ? 'Transaction declined in Trust Wallet' : 'Wallet response uncertain. Inspect Trust Wallet before submitting any new proposal.')
    }
    const pending = {...hashes, [trade.id]: hash}; setHashes(pending); localStorage.setItem('defi-pending-hashes', JSON.stringify(pending))
    await api('receipt', {id: trade.id, hash}); await refreshTrades()
  }
  async function enableNetwork() {
    if (!provider) throw new Error('Connect your mobile wallet first')
    setNetworkSigning(false)
    const account = await requestNetworkAccess(provider,chainId)
    setConnected(account); setWallet(account); setNetworkSigning(true)
  }
  async function reconnectSelectedNetwork() {
    await provider?.disconnect?.()
    setProvider(undefined); setConnected(''); setWallet(''); setConnectionKind(''); setNetworkSigning(false)
    await connect('mobile')
  }
  async function chat() {
    if (!message.trim()) return
    const content = message; setMessage('')
    setChatProgress({stage:'Connecting to agent', elapsedSeconds:0})
    setConversation(c => [...c, {role:'You', text:content}, {role:'Agent', text:''}])
    try {
    const response = await fetch('/api/chat', {method:'POST', headers:{'content-type':'application/json', 'x-defi-ui':'1'}, body:JSON.stringify({message:content, context:dashboardContext(connected, wallet, network)}), signal:AbortSignal.timeout(120000)})
    if (!response.ok || !response.body) throw new Error('Agent is unavailable or processing another request')
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', completed = false
    while (true) {
      const {value, done} = await reader.read(); if(done) break
      buffer += decoder.decode(value, {stream:true})
      const lines = buffer.split('\n'); buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) continue
        const item = JSON.parse(line)
        if(item.error) throw new Error(item.error)
        if(item.progress) setChatProgress(item.progress)
        if(item.done) completed = true
        const event = item.event
        if (!event) continue
        setActivity(a => [...a.slice(-19), event.eventType])
        if(event.eventType === 'agent.assistant') {
          const content = event.payload?.message?.content
          const text = item.text ?? (typeof content === 'string' ? content : (content ?? []).filter((b: {type:string}) => b.type === 'text').map((b: {text:string}) => b.text).join(''))
          setConversation(c => c.map((row,i) => i === c.length-1 ? {...row, text:row.text + text} : row))
        }
      }
    }
    if (!completed) throw new Error('The response connection ended early. Check existing proposals before requesting another swap.')
    await refreshTrades()
    } catch (error) {
      const text = error instanceof Error && error.name === 'TimeoutError' ? 'The connection timed out. The agent may still be running; check existing proposals before requesting another swap.' : error instanceof Error ? error.message : 'Agent request failed.'
      setConversation(c => c.map((row,i) => i === c.length-1 && row.role === 'Agent' && !row.text ? {...row, text} : row))
      throw new Error(text)
    }
  }
  const ethPercent = portfolio?.valuation?.assets[0]?.allocationPercent ?? 0
  return <div className="shell">
    <aside><a className="brand" href="/"><span className="brand-mark"><Icon name="agent"/></span><span className="brand-name">DeFi Autopilot</span></a><a className="nav active" href="#overview"><Icon name="overview"/> Overview</a><a className="nav" href="#agent"><Icon name="agent"/> Agent</a><a className="nav" href="#trades"><Icon name="swap"/> Swaps</a><div className="sidebar-bottom"><span className="dot"/> {networks[network].name}</div></aside>
    <main><header><div><h1>Portfolio</h1></div><div className="wallet-actions">{connected ? <><span>{connected.slice(0,6)}…{connected.slice(-4)}</span><button className="secondary" disabled={busy} onClick={()=>run(async()=>{await provider?.disconnect?.();setProvider(undefined);setConnected('');setWallet('');setConnectionKind('');setNetworkSigning(false)})}>Disconnect</button></> : <><button disabled={busy} onClick={()=>run(()=>connect('mobile'))}>Connect wallet</button><button className="secondary" disabled={busy} onClick={()=>run(()=>connect('extension'))}>Use extension</button></>}</div></header>
    <div className="notice network-notice"><label>Network<select disabled={busy} value={network} onChange={e=>setNetwork(e.target.value as Network)}><option value="base">Base Mainnet</option><option value="mainnet">Ethereum Mainnet</option><option value="sepolia">Ethereum Sepolia · testnet</option></select></label><span className="execution-status"><Icon name="lock"/>{activeConfig?.executionEnabled ? 'Wallet approval required' : 'Trading locked'}</span></div>
    {activeConfig && !activeConfig.rpcConfigured && <div className="error">RPC is not configured for {networks[network].name}. Set its backend RPC URL and restart.</div>}
    {error && <div role="alert" className="error">{error}</div>}
    {connected && connectionKind === 'mobile' && !networkSigning && <div className="notice session-notice"><span>Approve this network in your wallet to trade.</span><button disabled={busy} onClick={()=>run(enableNetwork)}>Request {networks[network].name} access</button><button className="secondary" disabled={busy} onClick={()=>run(reconnectSelectedNetwork)}>Pair again for {networks[network].name}</button></div>}
    <section id="overview" className="wallet-bar"><label>Wallet address<input value={wallet} readOnly={Boolean(connected)} onChange={e=>setWallet(e.target.value)} placeholder="Connect a wallet or enter an address to view" /></label><button disabled={busy} onClick={()=>run(async()=>setPortfolio(await api('portfolio',{wallet,network})))}><Icon name="refresh"/> Refresh</button></section>
    <section className="metrics">
      <article>
        <div className="metric-heading"><p>Portfolio value</p><span className="metric-symbol"><Icon name="wallet"/></span></div>
        <strong title={portfolio?.valuation?.total}>{displayNumber(portfolio?.valuation?.total)}$ <small>{portfolio?.valuation?.currency ?? (network === 'sepolia' ? 'test USDC' : 'USD')}</small></strong>
      </article>
      <article>
        <div className="metric-heading token-heading"><TokenIcon token="ETH"/><p>ETH</p></div>
        <strong title={portfolio?.portfolio.native.balance}>{displayNumber(portfolio?.portfolio.native.balance, 8)}</strong>
      </article>
      <article>
        <div className="metric-heading token-heading"><TokenIcon token="USDC"/><p>USDC</p></div>
        <strong title={portfolio?.portfolio.tokens[0]?.balance}>{displayNumber(portfolio?.portfolio.tokens[0]?.balance, 6)}</strong>
      </article>
    </section>
    <section className="two-col">
      <article className="panel">
        <div className="panel-title"><h2>Allocation</h2></div>
        <div className="allocation">
          <div className="donut" role="img" aria-label={portfolio?.valuation ? `${ethPercent.toFixed(1)}% ETH and ${(100-ethPercent).toFixed(1)}% USDC` : 'Allocation not available'} style={{background: portfolio?.valuation ? `conic-gradient(var(--blue) ${ethPercent}%, #a8c7ff 0)` : '#edf1f7'}}><div><strong>{portfolio?.valuation ? ethPercent.toFixed(1)+'%' : '—'}</strong><span>ETH</span></div></div>
          <div className="allocation-legend"><p><TokenIcon token="ETH"/> ETH <b>{portfolio?.valuation ? ethPercent.toFixed(1)+'%' : '—'}</b></p><p><TokenIcon token="USDC"/> USDC <b>{portfolio?.valuation ? (100-ethPercent).toFixed(1)+'%' : '—'}</b></p>{portfolio?.valuationError && <small role="status">{portfolio.valuationError}</small>}</div>
        </div>
      </article>
      <article className="panel market-panel">
        <div className="panel-title"><h2 className="token-title"><TokenIcon token="ETH"/> ETH price</h2><span>{network === 'sepolia' ? 'UNISWAP V3' : 'COINGECKO'}</span></div>
        <p className="price" title={portfolio?.pricing?.ethUsd ?? portfolio?.spot?.usdcPerEth}>{displayNumber(portfolio?.pricing?.ethUsd ?? portfolio?.spot?.usdcPerEth)} <small>{network === 'sepolia' ? 'test USDC / ETH' : 'USD / ETH'}</small></p>
        <p className="market-details">{network === 'sepolia' ? `Fee tier ${portfolio?.spot?.feeTier ? portfolio.spot.feeTier/10000+'%' : '—'} · Block ${portfolio?.spot?.blockNumber ?? '—'}` : `USDC / USD ${displayNumber(portfolio?.pricing?.usdcUsd, 4)} · Updated ${portfolio?.pricing?.observedAt ? new Date(portfolio.pricing.observedAt).toLocaleTimeString() : '—'}`}</p>
      </article>
    </section>
    <section id="agent" className="panel"><div className="panel-title"><h2>Agent</h2></div><div className="chat">{conversation.length ? conversation.map((row,i)=><div className={'chat-row '+row.role} key={i}><small>{row.role}</small>{row.role === 'Agent' && row.text ? <AgentResponse text={row.text}/> : <p>{row.text || `${chatProgress.stage}… ${chatProgress.elapsedSeconds}s`}</p>}</div>) : <div className="chat-empty"><Icon name="agent"/>What would you like to do?</div>}</div><form onSubmit={e=>{e.preventDefault();run(chat)}}><input aria-label="Message to agent" value={message} onChange={e=>setMessage(e.target.value)} placeholder="How much ETH do I have, and what is it worth?"/><button disabled={busy}>Send ↗</button></form>{activity.length>0&&<details><summary>Live tool activity · {activity.length} events</summary><pre>{activity.join('\n')}</pre></details>}</section>
    <section id="trades" className="panel"><div className="panel-title"><h2>Swaps</h2><button className="secondary" disabled={busy} onClick={()=>run(refreshTrades)}>Refresh</button></div><SwapCalculator network={network} wallet={connected || wallet} busy={busy} onReview={input => run(async()=>{await api('prepare',{wallet:connected || wallet,...input});await refreshTrades()})} onApproval={input => run(async()=>{await api('prepare',{wallet:connected || wallet,...input,approvalOnly:true});await refreshTrades()})}/>
    <details className="policy-details"><summary>Trade limits</summary><p>Mainnet: ${activeConfig?.maxTradeUsd ?? '100'} per swap, ${activeConfig?.maxGasUsd ?? '5'} estimated gas. Fresh validation before signing. USDC → ETH requires an allowance approval first.</p></details>
    {trades.length===0&&<p className="empty">No swaps yet.</p>}{trades.filter(trade=>(trade.input?.network ?? 'sepolia')===network).map(trade=><div className="trade" key={trade.id}><div className="panel-title"><h3>{trade.validation.quote ? trade.validation.kind === 'usdc_approval' ? `Approve ${trade.validation.quote.amountIn} USDC allowance` : `${trade.validation.quote.amountIn} ${trade.validation.quote.tokenIn} → ${trade.validation.quote.amountOut} ${trade.validation.quote.tokenOut}` : 'Swap proposal'}</h3><span className={'badge '+trade.status}>{trade.status.replace('_',' ')}</span></div><p className="muted">{trade.id.slice(0,12)} · Minimum output {trade.validation.minimumOut ?? '—'} {trade.validation.quote?.tokenOut ?? 'USDC'}</p>{trade.validation.economics&&<p>Expected allocation {trade.validation.economics.quotedEthPercent}% ETH / {trade.validation.economics.quotedUsdcPercent}% USDC</p>}<details><summary>Validation checks</summary>{trade.validation.checks.map((check,i)=><p key={i} className={check.passed?'pass':'fail'}>{check.passed?'✓':'×'} {check.name}: {check.explanation}</p>)}</details>{trade.status==='prepared'&&!trade.validation.executionEnabled&&<p className="muted">Validated · trading locked</p>}{trade.result&&<details><summary>On-chain verification · {trade.result.confirmations ?? 0} confirmations</summary><p>Receipt: {trade.result.receiptStatus} · Block {trade.result.blockNumber ?? '—'}</p><p>Swap input {trade.result.inputVerified?'verified':'unverified'} · Output {trade.result.outputVerified?'verified':'unverified'} · Balances {trade.result.balancesVerified?'verified':'pending'}</p>{trade.result.portfolio&&<p>After transaction block: {trade.result.portfolio.native.balance} ETH / {trade.result.portfolio.tokens[0]?.balance ?? 'unavailable'} USDC</p>}</details>}{trade.status==='prepared'&&<button disabled={busy||!connected||!networkSigning||!activeConfig?.executionEnabled||!trade.validation.executionEnabled} onClick={()=>run(()=>approve(trade))}>Review & sign in Trust Wallet</button>}{trade.status==='awaiting_wallet'&&!hashes[trade.id]&&<p className="muted">Inspect Trust Wallet for a pending or submitted transaction. If submitted, paste its hash to recover tracking.</p>}{['awaiting_wallet','submitted','verification_pending','verification_failed'].includes(trade.status)&&<form onSubmit={e=>{e.preventDefault();run(async()=>{await api('receipt',{id:trade.id,hash:hashes[trade.id]??trade.hash});await refreshTrades()})}}><input aria-label="Transaction hash" placeholder="0x transaction hash" value={hashes[trade.id]??trade.hash??''} onChange={e=>setHashes(h=>({...h,[trade.id]:e.target.value}))}/><button disabled={busy}>Verify receipt</button></form>}{trade.hash&&<a target="_blank" rel="noreferrer" href={`${networks[network].explorer}/tx/${trade.hash}`}>View transaction ↗</a>}</div>)}
    </section></main>
  </div>
}
export default App

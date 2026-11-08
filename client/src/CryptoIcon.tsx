import { TokenIcon } from './TokenIcon'

export function CryptoIcon({ name }: { name: 'base' | 'ethereum' | 'uniswap' | 'walletconnect' }) {
  if (name === 'ethereum') return <TokenIcon token="ETH"/>
  if (name === 'uniswap') return <img className="crypto-icon" src="/uniswap.png" alt="" width="32" height="32"/>
  return <svg className="crypto-icon" viewBox="0 0 40 40" aria-hidden="true">
    {name === 'base' ? <><circle cx="20" cy="20" r="20" fill="#0052ff"/><path d="M7 20h26" stroke="white" strokeWidth="3"/></> : <><circle cx="20" cy="20" r="20" fill="#eaf3ff"/><path d="M9 16a16 16 0 0 1 22 0m-18 4 4 4 3-3 3 3 4-4" fill="none" stroke="#3396ff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/></>}
  </svg>
}

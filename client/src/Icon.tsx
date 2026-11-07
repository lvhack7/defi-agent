import type { ReactNode } from 'react'

type IconName = 'overview' | 'agent' | 'swap' | 'wallet' | 'lock' | 'refresh' | 'eth'

const paths: Record<IconName, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  agent: <><path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3Z"/><path d="M20 2v4m-2-2h4"/></>,
  swap: <><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/></>,
  wallet: <><path d="M20 8V5a2 2 0 0 0-2-2L5 6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h15V8H5"/><path d="M20 12h-5v5h5m-3-2.5h.01"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.1 8a7 7 0 0 1 11.5-3L20 9M4 15l3.4 4A7 7 0 0 0 18.9 16"/></>,
  eth: <><path d="m12 2 6 10-6 3-6-3 6-10Zm-6 13 6 7 6-7-6 3-6-3Z"/><path d="M12 2v13m-6-3 6-3 6 3"/></>,
}

export function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

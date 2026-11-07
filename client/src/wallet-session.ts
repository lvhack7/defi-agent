export type WalletSession = {
  namespaces: Record<string, { accounts: string[]; methods: string[]; chains?: string[] }>
}

export function supportsSigning(session: WalletSession | undefined, chainId: number): boolean {
  if (![1, 8453, 11155111].includes(chainId)) return false;
  if (!session) return false
  return Object.entries(session.namespaces).some(([namespace, permissions]) =>
    (namespace === 'eip155' || namespace === `eip155:${chainId}`) &&
    permissions.accounts.some(account => account.startsWith(`eip155:${chainId}:`)) &&
    permissions.methods.includes('eth_sendTransaction'),
  )
}

export function describeWalletPermissions(session?: WalletSession): string {
  if (!session) return 'No active WalletConnect session.'
  const networks = new Set<string>()
  const methods = new Set<string>()
  for (const [namespace, permissions] of Object.entries(session.namespaces)) {
    if (namespace !== 'eip155' && !namespace.startsWith('eip155:')) continue
    for (const account of permissions.accounts) networks.add(account.split(':').slice(0, 2).join(':'))
    for (const chain of permissions.chains ?? []) networks.add(chain)
    for (const method of permissions.methods) methods.add(method)
  }
  const names: Record<string, string> = { 'eip155:1': 'Ethereum mainnet (1)', 'eip155:8453': 'Base Mainnet (8453)', 'eip155:11155111': 'Ethereum Sepolia (11155111)' }
  return `Approved networks: ${[...networks].map(chain => names[chain] ?? chain).join(', ') || 'none'}. Approved methods: ${[...methods].join(', ') || 'none'}.`
}

type SwitchableProvider = {
  session?: WalletSession
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

export async function requestNetworkAccess(provider: SwitchableProvider, chainId: number): Promise<string> {
  if (![1, 8453, 11155111].includes(chainId)) throw new Error('Unsupported network');
  const target = chainId === 8453 ? 'Base Mainnet' : chainId === 1 ? 'Ethereum Mainnet' : 'Ethereum Sepolia';
  const canSwitch = Object.entries(provider.session?.namespaces ?? {}).some(([key, permissions]) =>
    (key === 'eip155' || key.startsWith('eip155:')) && permissions.methods.includes('wallet_switchEthereumChain'),
  )
  if (!canSwitch) throw new Error(`This session cannot request a network switch to ${target}. Reconnect a compatible wallet.`)
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${chainId.toString(16)}` }] })
  } catch (error) {
    const code = (error as { code?: number }).code
    if (code === 4001 || code === 5000) throw new Error(`${target} network request was declined. No transaction was requested.`)
    throw new Error(`The wallet could not switch to ${target}${typeof code === 'number' ? ` (code ${code})` : ''}. No transaction was requested. Use a wallet that supports ${target} if this wallet cannot enable it.`)
  }
  // A local provider chain change alone is not authorization. Wait briefly for the wallet's session update.
  for (let attempt = 0; attempt < 20 && !supportsSigning(provider.session, chainId); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!supportsSigning(provider.session, chainId)) throw new Error(`The wallet returned from switching but did not grant ${target} signing permission. ${describeWalletPermissions(provider.session)} No transaction was requested.`)
  if (Number(await provider.request({ method: 'eth_chainId' })) !== chainId) throw new Error(`The active wallet network is not ${target}. Trading stays disabled.`)
  const accounts = await provider.request({ method: 'eth_accounts' }) as string[]
  const authorized = new Set(Object.values(provider.session!.namespaces).flatMap(n => n.accounts).filter(a => a.startsWith(`eip155:${chainId}:`)).map(a => a.split(':')[2].toLowerCase()))
  const account = accounts.find(a => authorized.has(a.toLowerCase()))
  if (!account) throw new Error('No approved Sepolia account was returned by the wallet.')
  return account
}

export const supportsSepoliaSigning = (session?: WalletSession) => supportsSigning(session, 11155111)
export const requestSepoliaAccess = (provider: SwitchableProvider) => requestNetworkAccess(provider, 11155111)

export async function pairForNetwork(provider: {
  session?: WalletSession
  disconnect: () => Promise<void>
  connect: (options: { chains: number[] }) => Promise<void>
}, chainId: number): Promise<void> {
  if (![1, 8453, 11155111].includes(chainId)) throw new Error('Unsupported network')
  if (provider.session && !supportsSigning(provider.session, chainId)) await provider.disconnect()
  if (!provider.session) await provider.connect({ chains: [chainId] })
  if (!supportsSigning(provider.session, chainId)) throw new Error(`The wallet did not approve chain ${chainId} transaction signing. Pairing cannot fall back to another network.`)
}

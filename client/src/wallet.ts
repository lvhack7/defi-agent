import type { WalletSession } from './wallet-session'

export type WalletProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown
  disconnect?: () => Promise<void>
  isTrust?: boolean
  isTrustWallet?: boolean
  providers?: WalletProvider[]
  session?: WalletSession
}
declare global { interface Window { ethereum?: WalletProvider; trustwallet?: { ethereum?: WalletProvider } } }

export function extensionProvider(): WalletProvider {
  const candidates = window.ethereum?.providers ?? (window.ethereum ? [window.ethereum] : [])
  const provider = window.trustwallet?.ethereum ?? candidates.find(p => p.isTrust || p.isTrustWallet)
  if (!provider) throw new Error('Trust Wallet extension was not found. Choose “Connect mobile · QR” to use your phone.')
  return provider
}

type MobileProvider = InstanceType<typeof import('@walletconnect/ethereum-provider').EthereumProvider>
let mobile: Promise<MobileProvider> | undefined
let mobileChainId: number | undefined
export async function mobileProvider(chainId: number) {
  if (![1, 8453, 11155111].includes(chainId)) throw new Error('Unsupported wallet network')
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim()
  if (!projectId) throw new Error('Set VITE_WALLETCONNECT_PROJECT_ID in the root .env.local to your Reown project ID, then rebuild the dashboard.')
  if (mobile && mobileChainId !== chainId) {
    const previous = await mobile
    if (previous.session) await previous.disconnect()
    mobile = undefined
  }
  if (!mobile) {
    mobileChainId = chainId
    mobile = (async () => {
      const { EthereumProvider } = await import('@walletconnect/ethereum-provider')
      return EthereumProvider.init({
        projectId,
        // Require the user's selected network. Never accept a mainnet-only fallback for Base.
        chains: [chainId],
        methods: ['eth_sendTransaction'],
        optionalMethods: ['wallet_switchEthereumChain'],
        optionalEvents: ['accountsChanged', 'chainChanged'],
        showQrModal: true,
        rpcMap: { 8453: 'https://mainnet.base.org', 1: 'https://ethereum-rpc.publicnode.com', 11155111: 'https://ethereum-sepolia-rpc.publicnode.com' },
        metadata: {
          name: 'DeFi Autopilot',
          description: 'ETH and USDC treasury with explicit network selection and wallet approval',
          url: window.location.origin,
          icons: [`${window.location.origin}/favicon.svg`],
        },
      })
    })().catch(error => { mobile = undefined; throw error })
  }
  return mobile
}

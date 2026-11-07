export function dashboardContext(connected: string, watchAddress: string, network: 'base' | 'mainnet' | 'sepolia') {
  const wallet = connected.trim() || watchAddress.trim() || null
  return {
    network,
    wallet,
    walletSource: connected.trim() ? 'connected' as const : wallet ? 'watch' as const : 'none' as const,
  }
}

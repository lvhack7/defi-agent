import { createPublicClient, http, isAddress, getAddress, parseAbi, formatUnits } from 'viem';
import { networkConfig, networkName, rpcFor } from './networks.mts';

const abi = parseAbi(['function allowance(address owner,address spender) view returns (uint256)']);

// Read-only UI guidance. Trade validation reads allowance again before release.
export async function getUsdcAllowance(input: unknown, rpcOverride?: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid allowance input');
  const v = input as Record<string, unknown>;
  if (Object.keys(v).some(key => !['wallet', 'network'].includes(key))) throw new Error('Unknown input field');
  if (typeof v.wallet !== 'string' || !isAddress(v.wallet)) throw new Error('Invalid wallet address');
  const network = networkName(v.network), { chain, usdc, router } = networkConfig(network), wallet = getAddress(v.wallet);
  const client = createPublicClient({ chain, transport: http(rpcFor(network, rpcOverride), { timeout: 10000, retryCount: 1 }) });
  const [chainId, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber({ cacheTime: 0 })]);
  if (chainId !== chain.id) throw new Error('Invalid RPC chain for allowance');
  const amount = await client.readContract({ address: usdc, abi, functionName: 'allowance', args: [wallet, router], blockNumber });
  return { network, chainId, wallet, token: usdc, spender: router, rawAllowance: amount.toString(), allowance: formatUnits(amount, 6), blockNumber: blockNumber.toString() };
}

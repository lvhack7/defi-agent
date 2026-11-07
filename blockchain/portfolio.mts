import { createPublicClient, http, getAddress, isAddress, formatUnits, parseAbi, type Address } from 'viem';
import { networkConfig, networkName, rpcFor, type Network } from './networks.mts';

const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)']);
export type PortfolioInput = { wallet: string; network: Network; tokens?: string[]; includeUsdc?: boolean };
export function validateInput(input: unknown): { wallet: Address; network: Network; tokens: Address[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be an object');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => key !== 'wallet' && key !== 'tokens' && key !== 'network' && key !== 'includeUsdc')) throw new Error('Unknown input field');
  const network = networkName(value.network);
  if (typeof value.wallet !== 'string' || !isAddress(value.wallet)) throw new Error('Invalid wallet address');
  if (value.tokens !== undefined && (!Array.isArray(value.tokens) || value.tokens.length > 20)) throw new Error('tokens must be an array of at most 20 addresses');
  if (value.includeUsdc !== undefined && typeof value.includeUsdc !== 'boolean') throw new Error('Invalid includeUsdc: expected boolean');
  const tokens = (value.tokens ?? []) as unknown[];
  if (tokens.some(token => typeof token !== 'string' || !isAddress(token))) throw new Error('Invalid token address');
  const addresses = tokens.map(token => getAddress(token as string));
  if (new Set(addresses.map(address => address.toLowerCase())).size !== addresses.length) throw new Error('Duplicate token address');
  if (value.includeUsdc && !addresses.some(address => address.toLowerCase() === networkConfig(network).usdc.toLowerCase())) addresses.push(getAddress(networkConfig(network).usdc));
  return { wallet: getAddress(value.wallet), network, tokens: addresses };
}

export async function getPortfolio(input: unknown, rpcOverride?: string, blockOverride?: bigint) {
  const { wallet, network, tokens } = validateInput(input);
  const { chain } = networkConfig(network);
  const rpcUrl = rpcFor(network, rpcOverride);
  const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 10000, retryCount: 1 }) });
  const [actualChainId, blockNumber] = await Promise.all([client.getChainId(), blockOverride ?? client.getBlockNumber()]);
  if (actualChainId !== chain.id) throw new Error(`RPC endpoint does not match ${chain.name} (chain ID ${chain.id})`);
  const [native, tokenResults] = await Promise.all([client.getBalance({ address: wallet, blockNumber }), Promise.all(tokens.map(async address => {
    try {
      const [balance, decimals, symbol] = await Promise.all([
        client.readContract({ address, abi: erc20, functionName: 'balanceOf', args: [wallet], blockNumber }),
        client.readContract({ address, abi: erc20, functionName: 'decimals', blockNumber }),
        client.readContract({ address, abi: erc20, functionName: 'symbol', blockNumber }),
      ]);
      return { address, symbol, decimals, rawBalance: balance.toString(), balance: formatUnits(balance, decimals) };
    } catch { return { address, error: 'Unable to read token balance or metadata at this block' }; }
  }))]);
  return { chainId: chain.id, chain: chain.name, wallet, blockNumber: blockNumber.toString(), native: { symbol: 'ETH', decimals: 18, rawBalance: native.toString(), balance: formatUnits(native, 18) }, tokens: tokenResults };
}

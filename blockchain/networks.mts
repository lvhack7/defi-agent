import { mainnet, sepolia, base } from 'viem/chains';
import type { Address } from 'viem';
export type Network = 'mainnet' | 'sepolia' | 'base';
export function networkName(value: unknown = 'sepolia'): Network {
  if (value !== 'mainnet' && value !== 'sepolia' && value !== 'base') throw new Error('Invalid network: choose mainnet, base or sepolia');
  return value;
}
export function networkConfig(value: unknown = 'sepolia') {
  const network = networkName(value);
  if (network === 'base') return { network, chain: base, rpcEnv: 'BASE_RPC_URL', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address, weth: '0x4200000000000000000000000000000000000006' as Address, factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD' as Address, quoter: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a' as Address, router: '0x2626664c2603336E57B271c5C0b26F421741e481' as Address, explorer: 'https://basescan.org' };
  const main = network === 'mainnet';
  return {
    network, chain: main ? mainnet : sepolia, rpcEnv: main ? 'ETHEREUM_RPC_URL' : 'SEPOLIA_RPC_URL',
    usdc: (main ? '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' : '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238') as Address,
    weth: (main ? '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' : '0xfff9976782d46cc05630d1f6ebab18b2324d6b14') as Address,
    factory: (main ? '0x1F98431c8aD98523631AE4a59f267346ea31F984' : '0x0227628f3F023bb0B980b67D528571c95c6DaC1c') as Address,
    quoter: (main ? '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' : '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3') as Address,
    router: (main ? '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45' : '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E') as Address,
    explorer: main ? 'https://etherscan.io' : 'https://sepolia.etherscan.io',
  };
}
export function rpcFor(value: unknown, override?: string): string {
  const config = networkConfig(value), rpc = override ?? process.env[config.rpcEnv];
  if (!rpc) throw new Error(`${config.rpcEnv} is not configured`);
  let url: URL;
  try { url = new URL(rpc); } catch { throw new Error(`${config.rpcEnv} must be an HTTP(S) URL`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${config.rpcEnv} must be an HTTP(S) URL`);
  return rpc;
}
export function networkFromChainId(chainId: number): Network {
  if (chainId === 8453) return 'base';
  if (chainId === 1) return 'mainnet';
  if (chainId === 11155111) return 'sepolia';
  throw new Error('Unsupported transaction chain');
}

export function executionEnabled(network: Network): boolean {
  return network === 'sepolia' || process.env[network === 'base' ? 'ENABLE_BASE_MAINNET_EXECUTION' : 'ENABLE_ETHEREUM_MAINNET_EXECUTION'] === 'true';
}

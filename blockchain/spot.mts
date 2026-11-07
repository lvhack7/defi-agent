import { createPublicClient, http, parseAbi, zeroAddress, formatUnits, type Address } from 'viem';
import { sepolia } from 'viem/chains';
const FACTORY = '0x0227628f3F023bb0B980b67D528571c95c6DaC1c';
const WETH = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14';
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const factoryAbi = parseAbi(['function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)']);
const poolAbi = parseAbi(['function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)', 'function liquidity() view returns (uint128)', 'function token0() view returns (address)', 'function token1() view returns (address)']);

// USDC is token0 and WETH is token1. sqrtPriceX96 is sqrt(raw WETH/raw USDC).
export function priceFromSqrt(sqrt: bigint): string {
  if (sqrt <= 0n) throw new Error('Pool price is not initialized');
  const scaled = (2n ** 192n * 10n ** 18n * 10n ** 8n) / (sqrt * sqrt * 10n ** 6n);
  if (scaled === 0n) throw new Error('Pool price is below supported precision');
  return formatUnits(scaled, 8);
}
export async function getSepoliaSpot(rpcOverride?: string, requestedPool?: Address) {
  const rpcUrl = rpcOverride ?? process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error('SEPOLIA_RPC_URL is not configured');
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl, { timeout: 10000, retryCount: 1 }) });
  if (await client.getChainId() !== sepolia.id) throw new Error('RPC endpoint is not Ethereum Sepolia');
  const blockNumber = await client.getBlockNumber();
  const block = await client.getBlock({ blockNumber });
  const age = Date.now() / 1000 - Number(block.timestamp);
  if (!Number.isFinite(age) || age > 300 || age < -60) throw new Error('Pool snapshot block is stale or has an invalid timestamp');
  const pools = await Promise.all([100, 500, 3000, 10000].map(async fee => ({ fee, address: await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'getPool', args: [USDC, WETH, fee], blockNumber }) })));
  const candidates = pools.filter(p => p.address !== zeroAddress && (!requestedPool || p.address.toLowerCase() === requestedPool.toLowerCase()));
  if (!candidates.length) throw new Error('No matching Sepolia WETH/USDC pool was found');
  // Fail closed if an RPC read fails; do not silently claim a pool is the most liquid.
  const states = await Promise.all(candidates.map(async p => {
    const [slot, liquidity, token0, token1] = await Promise.all([
      client.readContract({ address: p.address, abi: poolAbi, functionName: 'slot0', blockNumber }),
      client.readContract({ address: p.address, abi: poolAbi, functionName: 'liquidity', blockNumber }),
      client.readContract({ address: p.address, abi: poolAbi, functionName: 'token0', blockNumber }),
      client.readContract({ address: p.address, abi: poolAbi, functionName: 'token1', blockNumber }),
    ]);
    if (token0.toLowerCase() !== USDC.toLowerCase() || token1.toLowerCase() !== WETH.toLowerCase()) throw new Error('Pool token addresses do not match');
    return { ...p, sqrt: slot[0], liquidity };
  }));
  const active = states.filter(p => p.liquidity > 0n && p.sqrt > 0n).sort((a, b) => a.liquidity > b.liquidity ? -1 : a.liquidity < b.liquidity ? 1 : a.fee - b.fee);
  if (!active.length) throw new Error('No initialized pool with active liquidity');
  const chosen = active[0];
  return { usdcPerEth: priceFromSqrt(chosen.sqrt), pool: chosen.address, feeTier: chosen.fee, activeLiquidity: chosen.liquidity.toString(), blockNumber: blockNumber.toString(), blockTimestamp: new Date(Number(block.timestamp) * 1000).toISOString(), source: 'Uniswap v3 Ethereum Sepolia spot price', warning: 'Testnet spot price, not USD or a real-world oracle. Thin liquidity and manipulation can distort this price.' };
}

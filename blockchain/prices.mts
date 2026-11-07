import { formatUnits, parseUnits, type Address } from 'viem';
import { getSepoliaSpot } from './spot.mts';
import { networkName, type Network } from './networks.mts';
export type Pricing = { source: string; currency: 'USD' | 'test USDC'; usdcPerEth: string; ethUsd: string | null; usdcUsd: string | null; observedAt: string; ethUpdatedAt: string; usdcUpdatedAt: string; blockNumber?: string; pool?: Address; feeTier?: number };
export async function getCoinGeckoPrices(apiKey = process.env.COINGECKO_API_KEY, now = Date.now()): Promise<Pricing> {
  if (!apiKey) throw new Error('COINGECKO_API_KEY is not configured');
  const url = new URL('https://api.coingecko.com/api/v3/simple/price');
  url.search = new URLSearchParams({ ids: 'ethereum,usd-coin', vs_currencies: 'usd', include_last_updated_at: 'true' }).toString();
  let response: Response;
  try { response = await fetch(url, { headers: { 'x-cg-demo-api-key': apiKey }, signal: AbortSignal.timeout(10000) }); }
  catch { throw new Error('CoinGecko price request failed'); }
  if (!response.ok) throw new Error(`CoinGecko returned HTTP ${response.status}`);
  const data = await response.json() as Record<string, { usd?: unknown; last_updated_at?: unknown }>;
  function price(id: string) {
    const row = data?.[id];
    if (!row || typeof row.usd !== 'number' || !Number.isFinite(row.usd) || row.usd < 0.00000001 || row.usd >= 1e9 || typeof row.last_updated_at !== 'number' || !Number.isInteger(row.last_updated_at)) throw new Error(`CoinGecko price missing or invalid for ${id}`);
    const age = now - row.last_updated_at * 1000;
    if (age > 300000 || age < -60000) throw new Error(`CoinGecko price stale for ${id}`);
    return { value: row.usd.toFixed(8), updatedAt: new Date(row.last_updated_at * 1000).toISOString() };
  }
  const eth = price('ethereum'), usdc = price('usd-coin');
  const ratio = parseUnits(eth.value, 8) * 100000000n / parseUnits(usdc.value, 8);
  if (ratio <= 0n) throw new Error('CoinGecko exchange rate is below supported precision');
  return { source: 'CoinGecko Demo simple price API', currency: 'USD', usdcPerEth: formatUnits(ratio, 8), ethUsd: eth.value, usdcUsd: usdc.value, observedAt: new Date(now).toISOString(), ethUpdatedAt: eth.updatedAt, usdcUpdatedAt: usdc.updatedAt };
}
export async function getPricing(network: Network, pool?: Address): Promise<Pricing> {
  if (networkName(network) !== 'sepolia') return getCoinGeckoPrices();
  const spot = await getSepoliaSpot(undefined, pool);
  return { source: spot.source, currency: 'test USDC', usdcPerEth: spot.usdcPerEth, ethUsd: null, usdcUsd: null, observedAt: new Date().toISOString(), ethUpdatedAt: spot.blockTimestamp, usdcUpdatedAt: spot.blockTimestamp, blockNumber: spot.blockNumber, pool: spot.pool, feeTier: spot.feeTier };
}
export function pricingFresh(pricing: Pricing, now = Date.now()) {
  return [pricing.ethUpdatedAt, pricing.usdcUpdatedAt].every(timestamp => { const age = now - Date.parse(timestamp); return Number.isFinite(age) && age >= -60000 && age <= 300000; });
}

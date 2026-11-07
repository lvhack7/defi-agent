import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { calculateAllocation, analyzePortfolio } from './valuation.mts';
import { priceFromSqrt, getSepoliaSpot } from './spot.mts';
import { parseAbi, decodeFunctionData, encodeFunctionResult, zeroAddress } from 'viem';
const balances = { ETH: { rawBalance: '50000000000000000', decimals: 18 }, USDC: { rawBalance: '20000000', decimals: 6 } };
test('calculates test USDC values, allocation and target drift', () => {
  const result = calculateAllocation(balances, '2000', 40);
  assert.equal(result.total, '120');
  assert.equal(result.currency, 'test USDC');
  assert.equal(result.assets[0].valueUsdc, '100');
  assert.equal(result.assets[1].valueUsdc, '20');
  assert.equal(result.assets[0].allocationPercent, 83.3333);
  assert.equal(result.assets[0].driftPercentagePoints, 43.3333);
});
test('zero portfolio has undefined allocation', () => {
  const result = calculateAllocation({ ETH: { ...balances.ETH, rawBalance: '0' }, USDC: { ...balances.USDC, rawBalance: '0' } }, '2000');
  assert.equal(result.total, '0');
  assert.equal(result.assets[0].allocationPercent, null);
});
test('converts Q96 token1/token0 into test USDC per ETH', () => {
  assert.equal(priceFromSqrt(2n ** 96n), '1000000000000');
  assert.equal(priceFromSqrt(2n ** 97n), '250000000000');
  assert.throws(() => priceFromSqrt(0n));
});
test('rejects invalid allocation targets and unknown networks before network access', async () => {
  const wallet = '0x0000000000000000000000000000000000000001';
  await assert.rejects(analyzePortfolio({ wallet, network: 'sepolia', targetEthPercent: 101 }), /Invalid target/);
  await assert.rejects(analyzePortfolio({ wallet, network: 'unknown' }), /Invalid network/);
});
test('overlaps independent market/native/token reads and preserves ETH USD valuation', async () => {
  const originalFetch = globalThis.fetch;
  const oldRpc = process.env.BASE_RPC_URL, oldKey = process.env.COINGECKO_API_KEY;
  process.env.BASE_RPC_URL = 'https://rpc.example';
  process.env.COINGECKO_API_KEY = 'fixture';
  const abi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)']);
  let pricesStarted = false, nativeReadPending = false, sawConcurrentTokenRead = false, priceUnavailable = false;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.coingecko.com/')) {
      pricesStarted = true;
      if (priceUnavailable) throw new Error('Market provider unavailable');
      return new Response(JSON.stringify({ ethereum: { usd: 2000, last_updated_at: Math.floor(Date.now()/1000) }, 'usd-coin': { usd: 1, last_updated_at: Math.floor(Date.now()/1000) } }));
    }
    const request = JSON.parse(String(init?.body));
    let result: unknown;
    if (request.method === 'eth_chainId') result = '0x2105';
    if (request.method === 'eth_blockNumber') result = '0x64';
    if (request.method === 'eth_getBalance') {
      assert.ok(pricesStarted, 'market read should already be running');
      nativeReadPending = true;
      await new Promise(resolve => setImmediate(resolve));
      nativeReadPending = false;
      result = '0x11c37937e08000'; // 0.005 ETH
    }
    if (request.method === 'eth_call') {
      sawConcurrentTokenRead ||= nativeReadPending;
      const fn = decodeFunctionData({ abi, data: request.params[0].data }).functionName;
      if (fn === 'balanceOf') result = encodeFunctionResult({ abi, functionName: fn, result: 3000000n });
      if (fn === 'symbol') result = encodeFunctionResult({ abi, functionName: fn, result: 'USDC' });
      if (fn === 'decimals') result = encodeFunctionResult({ abi, functionName: fn, result: 6 });
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await analyzePortfolio({ wallet: '0x0000000000000000000000000000000000000001', network: 'base' });
    assert.ok(sawConcurrentTokenRead, 'token reads must overlap the native balance request');
    assert.equal(result.valuation?.total, '13');
    assert.equal(result.valuation?.assets[0].valueUsd, '10');
    priceUnavailable = true;
    const unavailable = await analyzePortfolio({ wallet: '0x0000000000000000000000000000000000000001', network: 'base' });
    assert.equal(unavailable.portfolio.native.balance, '0.005');
    assert.equal(unavailable.valuation, null);
    assert.match(unavailable.valuationError ?? '', /prices unavailable/);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldRpc === undefined) delete process.env.BASE_RPC_URL; else process.env.BASE_RPC_URL = oldRpc;
    if (oldKey === undefined) delete process.env.COINGECKO_API_KEY; else process.env.COINGECKO_API_KEY = oldKey;
  }
});
test('selects most active-liquidity pool using one Sepolia block', async () => {
  const originalFetch = globalThis.fetch;
  const factoryAbi = parseAbi(['function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)']);
  const poolAbi = parseAbi(['function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)', 'function liquidity() view returns (uint128)', 'function token0() view returns (address)', 'function token1() view returns (address)']);
  const calls: Array<{method:string;params:any[]}> = [];
  const usdc = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', weth = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14';
  globalThis.fetch = async (_input, init) => {
    const req = JSON.parse(String(init?.body)); calls.push(req);
    let result: unknown;
    if (req.method === 'eth_chainId') result = '0xaa36a7';
    if (req.method === 'eth_blockNumber') result = '0x64';
    if (req.method === 'eth_getBlockByNumber') result = { number: '0x64', timestamp: `0x${Math.floor(Date.now()/1000).toString(16)}` };
    if (req.method === 'eth_call') {
      const data = req.params[0].data as `0x${string}`;
      if (req.params[0].to.toLowerCase() === '0x0227628f3f023bb0b980b67d528571c95c6dac1c') {
        const { args } = decodeFunctionData({ abi: factoryAbi, data });
        result = encodeFunctionResult({ abi: factoryAbi, functionName: 'getPool', result: args[2] === 500 ? '0x0000000000000000000000000000000000000001' : args[2] === 3000 ? '0x0000000000000000000000000000000000000002' : zeroAddress });
      } else {
        const fn = decodeFunctionData({ abi: poolAbi, data }).functionName;
        if (fn === 'slot0') result = encodeFunctionResult({ abi: poolAbi, functionName: 'slot0', result: [2n ** 96n, 0, 0, 1, 1, 0, true] });
        if (fn === 'liquidity') result = encodeFunctionResult({ abi: poolAbi, functionName: 'liquidity', result: req.params[0].to.endsWith('2') ? 200n : 100n });
        if (fn === 'token0') result = encodeFunctionResult({ abi: poolAbi, functionName: 'token0', result: usdc });
        if (fn === 'token1') result = encodeFunctionResult({ abi: poolAbi, functionName: 'token1', result: weth });
      }
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const spot = await getSepoliaSpot('https://rpc.example');
    assert.equal(spot.feeTier, 3000);
    assert.equal(spot.usdcPerEth, '1000000000000');
    assert.equal(spot.blockNumber, '100');
    for (const call of calls.filter(c => c.method === 'eth_call')) assert.equal(call.params[1], '0x64');
  } finally { globalThis.fetch = originalFetch; }
});

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { decodeFunctionData, encodeFunctionResult, parseAbi, zeroAddress } from 'viem';
import { quoteSwap, planRebalance, proposeRebalance } from './uniswap.mts';
const factory = parseAbi(['function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)']);
const quoter = parseAbi(['function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)']);
test('rejects invalid quote inputs and allocation targets', async () => {
  await assert.rejects(quoteSwap({ tokenIn: 'BTC', amount: '1' }), /Invalid tokenIn/);
  await assert.rejects(quoteSwap({ tokenIn: 'USDC', amount: '0.0000001' }), /Invalid amount/);
  await assert.rejects(quoteSwap({ tokenIn: 'ETH', amount: '-1' }), /Invalid amount/);
  await assert.rejects(proposeRebalance({ wallet: '0x0000000000000000000000000000000000000001', targetEthPercent: 101 }), /Invalid target/);
});
test('computes buy and sell proposals from target without floating balance arithmetic', () => {
  assert.deepEqual(planRebalance('100', '20', '2000', '1', 40), { tokenIn: 'ETH', amount: '0.026' });
  assert.deepEqual(planRebalance('20', '100', '2000', '1', 40), { tokenIn: 'USDC', amount: '28' });
  assert.equal(planRebalance('0', '0', '2000', '1', 40), null);
  assert.equal(planRebalance('40', '60', '2000', '1', 40), null);
});
test('quotes direct pools at one block and distinguishes absence and simulation failures', async () => {
  const originalFetch = globalThis.fetch;
  let mode = 'quoted';
  const requests: Array<{method: string; params: any[]}> = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    let result: string | undefined;
    if (request.method === 'eth_chainId') result = '0xaa36a7';
    if (request.method === 'eth_blockNumber') result = '0x64';
    if (request.method === 'eth_call') {
      const data = request.params[0].data as `0x${string}`;
      const to = request.params[0].to.toLowerCase();
      if (to === '0x0227628f3f023bb0b980b67d528571c95c6dac1c') {
        const decoded = decodeFunctionData({ abi: factory, data });
        const fee = decoded.args[2];
        result = encodeFunctionResult({ abi: factory, functionName: 'getPool', result: mode === 'absent' || ![500, 3000].includes(fee) ? zeroAddress : '0x0000000000000000000000000000000000000001' });
      } else if (to === '0xed1f6473345f45b75f8179591dd5ba1888cf2fb3' && mode !== 'failure') {
        const decoded = decodeFunctionData({ abi: quoter, data });
        assert.equal(decoded.args[0].amountIn, 1000000000000000n);
        result = encodeFunctionResult({ abi: quoter, functionName: 'quoteExactInputSingle', result: [decoded.args[0].fee === 500 ? 2000000n : 1900000n, 1n, 0, 100000n] });
      }
    }
    return new Response(JSON.stringify(result === undefined ? { jsonrpc: '2.0', id: request.id, error: { code: 3, message: 'execution reverted' } } : { jsonrpc: '2.0', id: request.id, result }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const quote = await quoteSwap({ tokenIn: 'ETH', amount: '0.001' }, 'https://rpc.example');
    assert.equal(quote.status, 'quoted');
    if (quote.status === 'quoted') { assert.equal(quote.amountOut, '2'); assert.equal(quote.feeTier, 500); }
    for (const req of requests.filter(req => req.method === 'eth_call')) assert.equal(req.params[1], '0x64');
    mode = 'absent';
    assert.equal((await quoteSwap({ tokenIn: 'ETH', amount: '0.001' }, 'https://rpc.example')).status, 'no_pool');
    mode = 'failure';
    assert.equal((await quoteSwap({ tokenIn: 'ETH', amount: '0.001' }, 'https://rpc.example')).status, 'unavailable');
  } finally { globalThis.fetch = originalFetch; }
});

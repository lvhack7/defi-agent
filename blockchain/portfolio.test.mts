import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateInput, getPortfolio } from './portfolio.mts';
const wallet = '0x0000000000000000000000000000000000000001';
const network = 'mainnet';
test('validates portfolio inputs', () => {
  assert.equal(validateInput({ wallet, network }).wallet, wallet);
  assert.throws(() => validateInput({ wallet: 'bad', network }));
  assert.throws(() => validateInput({ wallet, network: 'unknown' }));
  assert.throws(() => validateInput({ wallet, network, tokens: [wallet, wallet] }));
  assert.throws(() => validateInput({ wallet, network, tokens: Array(21).fill(wallet) }));
  assert.throws(() => validateInput({ wallet, network, extra: true }));
  assert.throws(() => validateInput({ wallet, network, includeUsdc: 'yes' }));
  const usdc = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
  assert.deepEqual(validateInput({ wallet, network: 'sepolia', includeUsdc: true }).tokens, [usdc]);
  assert.deepEqual(validateInput({ wallet, network: 'sepolia', includeUsdc: true, tokens: [usdc] }).tokens, [usdc]);
});
test('requires a valid RPC URL', async () => {
  await assert.rejects(getPortfolio({ wallet, network }, ''), /not configured/);
  await assert.rejects(getPortfolio({ wallet, network }, 'file:///secret'), /HTTP/);
});

test('reads balances at one block and reports a token failure', async () => {
  const { encodeFunctionResult, parseAbi } = await import('viem');
  const abi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)']);
  const calls: Array<{ method: string; params: unknown[] }> = [];
  let chainId = '0x1';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_requestInput, init) => {
    const request = JSON.parse(String(init?.body));
    calls.push(request);
    let result: string | undefined;
    if (request.method === 'eth_chainId') result = chainId;
    if (request.method === 'eth_blockNumber') result = '0x64';
    if (request.method === 'eth_getBalance') result = '0xde0b6b3a7640000';
    if (request.method === 'eth_call') {
      const { to, data } = request.params[0];
      if (to.toLowerCase() !== '0x0000000000000000000000000000000000000002') {
        if (data.startsWith('0x70a08231')) result = encodeFunctionResult({ abi, functionName: 'balanceOf', result: 1234567n });
        if (data.startsWith('0x313ce567')) result = encodeFunctionResult({ abi, functionName: 'decimals', result: 6 });
        if (data.startsWith('0x95d89b41')) result = encodeFunctionResult({ abi, functionName: 'symbol', result: 'TEST' });
      }
    }
    return new Response(JSON.stringify(result === undefined ? { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'test failure' } } : { jsonrpc: '2.0', id: request.id, result }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await getPortfolio({ wallet, network, tokens: [wallet, '0x0000000000000000000000000000000000000002'] }, 'https://rpc.example');
    await assert.rejects(getPortfolio({ wallet, network: 'sepolia' }, 'https://rpc.example'), /does not match/);
    chainId = '0xaa36a7';
    const testnet = await getPortfolio({ wallet, network: 'sepolia', includeUsdc: true }, 'https://rpc.example');
    assert.equal(testnet.tokens[0].address, '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');
    assert.equal(testnet.tokens[0].balance, '1.234567');
    assert.equal(testnet.chainId, 11155111);
    assert.equal(testnet.native.balance, '1');
    assert.equal(result.blockNumber, '100');
    assert.equal(result.native.balance, '1');
    assert.equal(result.tokens[0].balance, '1.234567');
    assert.ok(result.tokens[1].error);
    for (const call of calls.filter(call => call.method === 'eth_call' || call.method === 'eth_getBalance')) assert.equal(call.params[1], '0x64');
  } finally { globalThis.fetch = originalFetch; }
});

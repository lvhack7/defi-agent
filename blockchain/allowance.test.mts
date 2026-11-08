import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionResult, parseAbi } from 'viem';
import { getUsdcAllowance } from './allowance.mts';
import { networkConfig } from './networks.mts';
const wallet = '0x0000000000000000000000000000000000001234';
const abi = parseAbi(['function allowance(address owner,address spender) view returns (uint256)']);

test('allowance reads bind the token, router, owner and pinned block to each selected chain', async () => {
  const original = globalThis.fetch;
  try {
    for (const network of ['base', 'mainnet', 'sepolia'] as const) {
      const config = networkConfig(network);
      globalThis.fetch = async (_url, init) => {
        const req = JSON.parse(String(init?.body));
        let result: unknown;
        if (req.method === 'eth_chainId') result = `0x${config.chain.id.toString(16)}`;
        else if (req.method === 'eth_blockNumber') result = '0x64';
        else if (req.method === 'eth_call') {
          assert.equal(req.params[0].to.toLowerCase(), config.usdc.toLowerCase());
          assert.equal(req.params[1], '0x64');
          const decoded = decodeFunctionData({ abi, data: req.params[0].data });
          assert.equal(decoded.args[0].toLowerCase(), wallet.toLowerCase());
          assert.equal(decoded.args[1].toLowerCase(), config.router.toLowerCase());
          result = encodeFunctionResult({ abi, functionName: 'allowance', result: 4400000n });
        } else throw new Error('Unexpected RPC: ' + req.method);
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }));
      };
      const allowance = await getUsdcAllowance({ network, wallet }, 'https://rpc.example');
      assert.equal(allowance.rawAllowance, '4400000');
      assert.equal(allowance.allowance, '4.4');
      assert.equal(allowance.chainId, config.chain.id);
      assert.equal(allowance.spender, config.router);
    }
  } finally { globalThis.fetch = original; }
});

test('wrong-chain and invalid allowance requests never read a token or send transactions', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const req = JSON.parse(String(init?.body));
      assert.ok(['eth_chainId', 'eth_blockNumber'].includes(req.method));
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: req.method === 'eth_chainId' ? '0x1' : '0x64' }));
    };
    await assert.rejects(getUsdcAllowance({ network: 'base', wallet }, 'https://rpc.example'), /RPC chain/);
    for (const input of [null, {}, { network: 'base', wallet: 'bad' }, { network: 'base', wallet, token: wallet }]) await assert.rejects(getUsdcAllowance(input, 'https://rpc.example'));
  } finally { globalThis.fetch = original; }
});

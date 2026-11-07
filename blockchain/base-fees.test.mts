import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicClient, custom, decodeFunctionData, encodeFunctionResult, parseAbi, parseTransaction } from 'viem';
import { base, mainnet } from 'viem/chains';
import { readBaseFeeComponents } from './base-fees.mts';
import { validationFailure } from './validation-errors.mts';

const abi = parseAbi(['function getL1Fee(bytes) view returns (uint256)', 'function getOperatorFee(uint256) view returns (uint256)']);
const tx = { account: '0x0000000000000000000000000000000000000001', to: '0x2626664c2603336E57B271c5C0b26F421741e481', value: 1000000000000000n, data: '0x1234' } as const;

test('Base fees use oracle reads and the existing gas estimate without eth_fillTransaction or re-simulation', async () => {
  const methods: string[] = [];
  const client = createPublicClient({ chain: base, transport: custom({ request: async ({ method, params }: any) => {
    methods.push(method);
    assert.equal(method, 'eth_call');
    assert.equal(params[0].to.toLowerCase(), base.contracts.gasPriceOracle.address.toLowerCase());
    const decoded = decodeFunctionData({ abi, data: params[0].data });
    if (decoded.functionName === 'getL1Fee') {
      const serialized = parseTransaction(decoded.args[0]);
      assert.equal(serialized.chainId, 8453);
      assert.equal(serialized.to?.toLowerCase(), tx.to.toLowerCase());
      assert.equal(serialized.data, tx.data);
      assert.equal(serialized.value, tx.value);
      return encodeFunctionResult({ abi, functionName: 'getL1Fee', result: 123n });
    }
    assert.equal(decoded.args[0], 150000n);
    return encodeFunctionResult({ abi, functionName: 'getOperatorFee', result: 45n });
  } }, { retryCount: 0 }) });
  assert.deepEqual(await readBaseFeeComponents(client, tx, 150000n), { l1Fee: 123n, operatorFee: 45n });
  assert.deepEqual(methods, ['eth_call', 'eth_call']);
});

test('each unavailable fee component fails closed with a precise, sanitized failure stage', async () => {
  for (const failing of ['getL1Fee', 'getOperatorFee'] as const) {
    const secret = 'private-rpc-token';
    const client = createPublicClient({ chain: base, transport: custom({ request: async ({ params }: any) => {
      const decoded = decodeFunctionData({ abi, data: params[0].data });
      if (decoded.functionName === failing) throw Object.assign(new Error(secret), { code: -32611 });
      return encodeFunctionResult({ abi, functionName: decoded.functionName, result: 0n });
    } }, { retryCount: 0 }) });
    await assert.rejects(readBaseFeeComponents(client, tx, 150000n), error => {
      const failure = validationFailure(error, 'base_fees');
      assert.equal(failure.stage, failing === 'getL1Fee' ? 'base_l1_fee' : 'base_operator_fee');
      assert.equal(failure.code, -32611);
      assert.ok(!JSON.stringify(failure).includes(secret));
      return true;
    });
  }
});

test('Base fee oracle reads cannot be reused under Ethereum chain configuration', async () => {
  const client = createPublicClient({ chain: mainnet, transport: custom({ request: async () => { throw new Error('No RPC call expected'); } }) });
  await assert.rejects(readBaseFeeComponents(client, tx, 150000n), /chain 8453/);
});

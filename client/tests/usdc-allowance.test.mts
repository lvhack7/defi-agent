import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasUsdcAllowance, fetchUsdcAllowance } from '../src/usdc-allowance.ts';

test('approval sufficiency compares exact USDC units, including approval smaller than full wallet balance', () => {
  assert.equal(hasUsdcAllowance('4400000', '4.4'), true);
  assert.equal(hasUsdcAllowance('4400000', '4.399999'), true);
  assert.equal(hasUsdcAllowance('4400000', '4.449811'), false);
  assert.equal(hasUsdcAllowance('0', '0.000001'), false);
  assert.equal(hasUsdcAllowance('1', '.000001'), true);
  for (const amount of ['0', '-1', '1e3', '0.0000001']) assert.equal(hasUsdcAllowance('4400000', amount), false);
});

test('allowance responses from another chain or wallet cannot enable the swap step', async () => {
  const original = globalThis.fetch;
  const wallet = '0x0000000000000000000000000000000000001234';
  const result = { network: 'base', chainId: 8453, wallet, rawAllowance: '4400000', allowance: '4.4' };
  try {
    globalThis.fetch = async () => Response.json(result);
    assert.equal((await fetchUsdcAllowance('base', wallet, AbortSignal.timeout(1000))).rawAllowance, '4400000');
    for (const change of [{ network: 'sepolia' }, { chainId: 1 }, { wallet: '0x0000000000000000000000000000000000005678' }, { rawAllowance: '-1' }]) {
      globalThis.fetch = async () => Response.json({ ...result, ...change });
      await assert.rejects(fetchUsdcAllowance('base', wallet, AbortSignal.timeout(1000)), /does not match/);
    }
  } finally { globalThis.fetch = original; }
});

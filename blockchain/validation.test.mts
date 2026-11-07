import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { assessEconomics, validateSwap, POLICY } from './validation.mts';
import { parseUnits } from 'viem';
const wallet = '0x4259e3c12Bc0ceB7345E38F88809a02Ff83cF502';
const p = (s: string, n: number) => parseUnits(s, n);
test('detects extreme example quote deviation and computes quote-based allocations', () => {
  const amount = p('0.026420858', 18), out = p('695.898683', 6);
  const result = assessEconomics({ ethRaw: p('0.05', 18), usdcRaw: p('20', 6), usdcPerEth: '2000' }, amount, out, out * 99n / 100n);
  assert.ok(Number(result.impliedUsdcPerEth) > 26000);
  assert.ok(result.deviationPercent > POLICY.maxDeviationPercent);
  assert.ok(result.quotedEthPercent < 10);
  assert.ok(result.minimumEthPercent > result.quotedEthPercent);
});
test('calculates target allocation from actual quoted output', () => {
  const result = assessEconomics({ ethRaw: p('1', 18), usdcRaw: p('0', 6), usdcPerEth: '2000' }, p('0.6', 18), p('1200', 6), p('1188', 6));
  assert.equal(result.quotedEthPercent, 40);
  assert.equal(result.quotedUsdcPercent, 60);
  assert.equal(result.deviationPercent, 0);
  assert.ok(result.minimumEthPercent > 40);
});
test('rejects zero or impossible balances and amounts', () => {
  assert.throws(() => assessEconomics({ ethRaw: 1n, usdcRaw: 0n, usdcPerEth: '2000' }, 2n, 1n, 1n));
  assert.throws(() => assessEconomics({ ethRaw: 1n, usdcRaw: 0n, usdcPerEth: '2000' }, 1n, 0n, 0n));
});
test('fails closed on excessive slippage and untrusted input', async () => {
  const result = await validateSwap({ wallet, amountEth: '0.01', slippageBps: 101 });
  assert.equal(result.status, 'rejected');
  assert.equal(result.executionEnabled, false);
  assert.equal(result.checks[0].name, 'slippage');
  const injected = await validateSwap({ wallet, amountEth: '0.01', slippageBps: 10, maxDeviation: 100 });
  assert.equal(injected.status, 'rejected');
  assert.equal(injected.executionEnabled, false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSwapAmount, normalizedAmount, swapRequestKey, usableSwapPreview, validSwapAmount, type SwapPreview, type SwapRequest } from '../src/swap-preview.ts';

const input: SwapRequest = { network: 'base', tokenIn: 'ETH', amount: '0.001', slippageBps: 50 };
const result: SwapPreview = { status: 'quoted', network: 'base', chainId: 8453, tokenIn: 'ETH', tokenOut: 'USDC', amountIn: '0.001', amountOut: '2.232942', minimumOut: '2.221777', slippageBps: 50, expiresAt: 30000, quotedAt: '', inputUsd: '2', outputUsd: '2', pricingWarning: null, rate: { amountOut: '2232.942' }, poolFee: { percent: 0.01, estimatedAmount: '0.0000001', token: 'ETH', includedInOutput: true } };

test('an old quote cannot be reused after amount, token, chain or slippage changes', () => {
  const snapshot = { key: swapRequestKey(input), result };
  assert.equal(usableSwapPreview(snapshot, input, 1000), result);
  for (const change of [{ amount: '0.002' }, { tokenIn: 'USDC' as const }, { network: 'sepolia' as const }, { slippageBps: 100 }]) assert.equal(usableSwapPreview(snapshot, { ...input, ...change }, 1000), null);
  assert.equal(usableSwapPreview(snapshot, input, 30000), null);
  assert.equal(usableSwapPreview({ key: swapRequestKey(input) }, input, 1000), null);
});

test('amount entry validates token decimals without floating-point arithmetic', () => {
  assert.equal(normalizedAmount(' .001 '), '0.001');
  assert.ok(validSwapAmount('.001', 'ETH'));
  assert.ok(validSwapAmount('0.000000000000000001', 'ETH'));
  assert.ok(validSwapAmount('0.000001', 'USDC'));
  for (const value of ['0', '-1', '1e-3', '0.0000001', 'NaN', '0x10']) assert.equal(validSwapAmount(value, 'USDC'), false);
});

test('display truncates amounts without rounding up or hiding tiny ETH output as zero', () => {
  assert.equal(formatSwapAmount('0.123456789', 'ETH'), '0.12345678');
  assert.equal(formatSwapAmount('0.0000000005', 'ETH'), '<0.00000001');
  assert.equal(formatSwapAmount('2232.942000', 'USDC'), '2,232.942');
});

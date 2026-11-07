import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swapCalculation, calculateSwap } from './swap-calculator.mts';
import type { Pricing } from './prices.mts';

const quotedAt = '2026-11-07T20:00:00.000Z';
const quote = { network: 'base', chainId: 8453, tokenIn: 'ETH', tokenOut: 'USDC', amountIn: '0.001', amountOut: '2.232942', quotedAt, blockNumber: '100', feeTier: 100, pool: '0x0000000000000000000000000000000000000001', fullInputConsumed: true } as const;
const pricing: Pricing = { source: 'fixture', currency: 'USD', usdcPerEth: '2500', ethUsd: '2000', usdcUsd: '0.8', observedAt: quotedAt, ethUpdatedAt: quotedAt, usdcUpdatedAt: quotedAt };

test('ETH to USDC uses actual quote output and rounds the slippage minimum down to token precision', () => {
  const result = swapCalculation(quote, 50, pricing);
  assert.equal(result.amountOut, '2.232942');
  assert.equal(result.rate.amountOut, '2232.942');
  assert.equal(result.minimumOut, '2.221777');
  assert.equal(result.poolFee.percent, 0.01);
  assert.equal(result.poolFee.estimatedAmount, '0.0000001');
  assert.equal(result.poolFee.includedInOutput, true);
  assert.equal(result.expiresAt, Date.parse(quotedAt) + 30000);
  assert.equal(result.networkFee.status, 'requires_validation');
  assert.ok(!('transaction' in result));
});

test('USD references use both market prices and never replace the quoted conversion rate', () => {
  const result = swapCalculation(quote, 50, pricing);
  assert.equal(result.inputUsd, '2');
  assert.equal(result.outputUsd, '1.7863536');
  assert.notEqual(result.amountOut, '2.5', 'do not substitute ETH/USD divided by USDC/USD');
});

test('USDC to ETH retains 18-decimal output precision and correct rate units', () => {
  const result = swapCalculation({ ...quote, tokenIn: 'USDC', tokenOut: 'ETH', amountIn: '5', amountOut: '0.002000000000000001' }, 50, pricing);
  assert.equal(result.rate.tokenIn, 'USDC');
  assert.equal(result.rate.tokenOut, 'ETH');
  assert.equal(result.minimumOut, '0.00199');
  assert.equal(result.poolFee.estimatedAmount, '0.0005');
  assert.equal(result.inputUsd, '4');
});

test('price outages retain on-chain output, and Sepolia never exposes real USD values', () => {
  const unavailable = swapCalculation(quote, 0, null);
  assert.equal(unavailable.amountOut, quote.amountOut);
  assert.equal(unavailable.minimumOut, quote.amountOut);
  assert.equal(unavailable.outputUsd, null);
  assert.ok(unavailable.pricingWarning);
  const testnet = swapCalculation({ ...quote, network: 'sepolia', chainId: 11155111 }, 50, pricing);
  assert.equal(testnet.inputUsd, null);
  assert.equal(testnet.outputUsd, null);
  assert.equal(testnet.pricingSource, null);
});

test('partial-input and invalid slippage quotes cannot be presented as full swaps', () => {
  assert.throws(() => swapCalculation({ ...quote, fullInputConsumed: false }, 50, pricing), /full input/);
  for (const bps of [-1, 101, 0.5, NaN]) assert.throws(() => swapCalculation(quote, bps, pricing), /slippage/);
});

test('invalid calculator input is rejected before network or price access', async () => {
  for (const input of [null, {}, { network: 'base', tokenIn: 'ETH', amount: '0' }, { network: 'mainnet', tokenIn: 'USDC', amount: '0.0000001' }, { network: 'base', tokenIn: 'ETH', amount: '0.001', slippageBps: null }, { network: 'base', tokenIn: 'USDT', amount: '1' }, { network: 'base', tokenIn: 'ETH', amount: '1', approvalOnly: true }]) {
    await assert.rejects(calculateSwap(input), /Invalid|Unknown/);
  }
});

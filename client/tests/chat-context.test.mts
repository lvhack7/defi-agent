import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardContext } from '../src/chat-context.ts';

test('connected wallet takes precedence over a manually entered address', () => {
  assert.deepEqual(dashboardContext('connected-account', 'another-account', 'base'), { wallet: 'connected-account', walletSource: 'connected', network: 'base' });
});

test('manual addresses remain available for viewing without wallet connection', () => {
  assert.deepEqual(dashboardContext('', ' watch-address ', 'sepolia'), { wallet: 'watch-address', walletSource: 'watch', network: 'sepolia' });
});

test('no connected or entered wallet produces an explicit empty context', () => {
  assert.deepEqual(dashboardContext('', ' ', 'base'), { wallet: null, walletSource: 'none', network: 'base' });
});

test('account and network changes use new values on the next message', () => {
  const original = dashboardContext('first-account', '', 'base');
  const updated = dashboardContext('second-account', '', 'mainnet');
  assert.equal(original.wallet, 'first-account');
  assert.equal(updated.wallet, 'second-account');
  assert.equal(updated.network, 'mainnet');
  assert.equal(dashboardContext('', '', 'mainnet').wallet, null);
});

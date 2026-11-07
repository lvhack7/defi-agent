import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OutboundEvent } from '@zoowork-ai/sdk';
import { submitTurn, type PendingTurn } from '../session-input.mts';
import { ZooworkError } from '@zoowork-ai/sdk';
import { agentError } from '../errors.mts';
import { boundedSdkFetch } from '../sdk-fetch.mts';

const pending: PendingTurn = { message: 'How much ETH do I have?', key: 'stable-turn-key', context: { network: 'base', wallet: '0x0000000000000000000000000000000000000001', walletSource: 'connected' } };

test('wallet context and question use a single user.message, avoiding the failing system.message route', async () => {
  const calls: OutboundEvent[][] = [];
  await submitTurn({ postEvents: async (agentId, sessionId, events) => {
    assert.equal(agentId, 'agent'); assert.equal(sessionId, 'session');
    calls.push(events);
    assert.deepEqual(events.map(event => event.type), ['user.message']);
    assert.match(String(events[0].content), /"network":"base"/);
    assert.ok(String(events[0].content).endsWith(pending.message));
    return { events: [{ accepted: true }] };
  } }, 'agent', 'session', pending);
  assert.equal(calls.length, 1, 'never send system.message, standalone or batched');
});

test('gateway failures can be retried with the same user idempotency key', async () => {
  const keys: unknown[] = [];
  const client = { postEvents: async (_agent: string, _session: string, events: OutboundEvent[]) => {
    keys.push(events[0].idempotency_key);
    if (keys.length === 1) throw new ZooworkError(502, 'upstream failed');
    return { events: [{ accepted: true }] };
  } };
  await assert.rejects(submitTurn(client, 'agent', 'session', pending), /upstream failed/);
  await submitTurn(client, 'agent', 'session', pending);
  assert.deepEqual(keys, ['stable-turn-key', 'stable-turn-key']);
});

test('missing or rejected event receipts cannot be reported as successful delivery', async () => {
  for (const events of [[], [{}], [{ accepted: false }], [{ accepted: true }, { accepted: true }]]) {
    await assert.rejects(submitTurn({ postEvents: async () => ({ events }) }, 'agent', 'session', pending), /did not accept/);
  }
});

test('API failures expose useful codes while hiding raw URLs, headers and bodies', () => {
  const secret = 'private-key-and-rpc-url';
  const gateway = agentError(new ZooworkError(502, secret, 'gateway_error'));
  assert.equal(gateway.code, 'zoowork_gateway');
  assert.match(gateway.message, /HTTP 502/);
  assert.ok(!JSON.stringify(gateway).includes(secret));
  assert.equal(agentError(new ZooworkError(401, secret)).code, 'zoowork_auth');
  assert.equal(agentError(new Error(secret, { cause: { code: 'ENOTFOUND' } })).code, 'zoowork_dns');
  assert.ok(!JSON.stringify(agentError(new Error(secret))).includes(secret));
});

test('SDK request cancellation is retained and SSE uses its explicit turn signal', async () => {
  const controller = new AbortController();
  let regularSignal: AbortSignal | null | undefined;
  const request = boundedSdkFetch(async (_input, init) => {
    regularSignal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });
  })('https://api.example', { signal: controller.signal });
  controller.abort(new Error('cancelled'));
  await assert.rejects(request, /cancelled/);
  assert.ok(regularSignal?.aborted);
  await boundedSdkFetch(async (_input, init) => {
    assert.equal(init?.signal, controller.signal);
    return new Response('');
  })('https://api.example/events/stream', { headers: { Accept: 'text/event-stream' }, signal: controller.signal });
});

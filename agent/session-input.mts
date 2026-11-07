import type { ZooworkClient } from '@zoowork-ai/sdk';
import { chatEvents, type ChatContext } from './chat-context.mts';

export type PendingTurn = { message: string; key: string; context?: ChatContext };

// One documented user.message carries the application context and the question.
// This deployment's system.message writer returns 502, including in batches.
export async function submitTurn(client: Pick<ZooworkClient, 'postEvents'>, agentId: string, sessionId: string, pending: PendingTurn) {
  const receipt = await client.postEvents(agentId, sessionId, chatEvents(pending.message, pending.context, pending.key));
  if (receipt.events.length !== 1 || receipt.events[0]?.accepted !== true) throw new Error('Agent did not accept the wallet context and message. Retry to recover this request.');
}

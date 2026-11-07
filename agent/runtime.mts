import { createZooworkClient, assistantText, customToolUse, isRunFinished, runOutcome, ZooworkError } from '@zoowork-ai/sdk';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import type { SessionEvent } from '@zoowork-ai/sdk';
import { handleTool, personaText, toolDeclarations } from './tools.mts';
import type { ChatContext } from './chat-context.mts';
import { toolStage, checkResponseDeadline, type ProgressReporter } from './progress.mts';
import { submitTurn, type PendingTurn } from './session-input.mts';
import { boundedSdkFetch } from './sdk-fetch.mts';
import { isDeepStrictEqual } from 'node:util';

// Local state is for a single operator and a single serial conversation.
const statePath = new URL('./.agent-state.json', import.meta.url);
type State = { creationKey: string; agentId?: string; sessionId?: string; cursor?: string; inFlight?: boolean; turnContext?: ChatContext; turnMessage?: string; pendingTurn?: PendingTurn };
async function load(): Promise<State> {
  try { return JSON.parse(await readFile(statePath, 'utf8')) as State; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { creationKey: `defi-autopilot-${randomUUID()}` };
  }
}
async function save(state: State) {
  const temporary = new URL('./.agent-state.tmp', import.meta.url);
  await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(temporary, statePath);
}
const client = createZooworkClient({ fetch: boundedSdkFetch() });
const state = await load();
await save(state); // Retain the creation key before making the request.

if (!state.agentId) {
  const model = (await client.listModels()).find(row => row.selectable !== false && row.default_for?.includes('model'))?.model;
  if (!model) throw new Error('No selectable default ZooWork model');
  const agent = await client.createAgent({ resource: {
    name: 'defi-autopilot', model: { primary: model }, include_global_skills: false,
    persona: { docs: [{ name: 'AGENTS.md', content: personaText }] },
    custom_tools: toolDeclarations,
  } }, state.creationKey);
  state.agentId = agent.agent_id;
  await save(state);
  console.log(`Created agent ${state.agentId}`);
}
const agentId = state.agentId;
// Preserve other tool declarations and only replace the original bootstrap persona.
const current = await client.getAgent(agentId);
const declared = current.declared;
if (!declared) throw new Error('Cannot inspect agent configuration');
const existingTools = declared.custom_tools;
if (existingTools !== undefined && !Array.isArray(existingTools)) throw new Error('Unexpected custom tool configuration');
const tools = (existingTools ?? []) as Array<Record<string, unknown>>;
const persona = declared.persona as { docs?: Array<{ name: string; content: string }> } | undefined;
const docs = persona?.docs ?? [];
const nextDocs = [...docs.filter(doc => !(doc.name === 'AGENTS.md' && doc.content.startsWith('You are DeFi Autopilot.'))), { name: 'AGENTS.md', content: personaText }];
const names = new Set(toolDeclarations.map(tool => tool.name));
const nextTools = [...tools.filter(tool => !names.has(String(tool.name))), ...toolDeclarations];
if (!isDeepStrictEqual(tools, nextTools) || !isDeepStrictEqual(docs, nextDocs)) {
  const version = current.status?.config_version ?? current.config_version;
  if (!version) throw new Error('Cannot safely update agent without a config version');
  await client.updateAgent(agentId, { expected_config_version: version, custom_tools: nextTools, persona: { ...persona, docs: nextDocs } });
}
await client.startAgent(agentId);
await client.waitUntilRunning(agentId);
if (!state.sessionId) {
  const session = await client.createSession(agentId, {}, `${state.creationKey}-session`);
  state.sessionId = session.session_id;
  await save(state);
}
const sessionId = state.sessionId;
console.log(`Agent ${agentId}; session ${sessionId}`);

async function resolveTool(callId: string, name?: string, input?: Record<string, unknown>, onProgress?: ProgressReporter) {
  const started = Date.now();
  onProgress?.(toolStage(name));
  let text: string;
  let isError = false;
  try {
    text = JSON.stringify(await handleTool(name, input, `${agentId}:${callId}`, state.turnContext));
  } catch (error) {
    isError = true;
    // Do not expose RPC URLs or provider credentials from transport errors.
    text = error instanceof Error && /^(Invalid |Unknown |Duplicate |tokens must|Input must|ETHEREUM_RPC_URL|SEPOLIA_RPC_URL|RPC endpoint)/.test(error.message)
      ? error.message : 'Portfolio read failed. Check the RPC configuration and availability.';
  }
  await client.resolveCustomToolCall(agentId, callId, { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });
  console.log(`[agent] ${toolStage(name)}: ${Date.now() - started}ms${isError ? ' (failed)' : ''}`);
  onProgress?.('Waiting for agent response');
}
async function streamTurn(onEvent?: (event: SessionEvent) => void, onProgress?: ProgressReporter) {
  const signal = AbortSignal.timeout(90000);
  // Recover calls that may have been requested before a disconnect or process restart.
  for (const call of await client.listCustomToolCalls(agentId, { status: 'pending', sessionId })) {
    if (call.session_id === sessionId) await resolveTool(call.call_id, call.name, call.input, onProgress);
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    checkResponseDeadline(signal);
    try {
      for await (const event of client.streamEvents(agentId, sessionId, { ...(state.cursor ? { cursor: state.cursor } : {}), signal })) {
        const call = customToolUse(event);
        // Forward tool activity before waiting for local RPC work to finish.
        onEvent?.(event);
        if (event.eventType === 'run.started' || event.eventType === 'agent.thinking') onProgress?.('Agent is thinking');
        if (call?.phase === 'requested') await resolveTool(call.callId, call.name, call.input, onProgress);
        if (event.cursor) state.cursor = event.cursor;
        if (isRunFinished(event)) {
          const outcome = runOutcome(event);
          state.inFlight = false;
          await save(state);

          if (outcome !== 'succeeded') throw new Error(`Run did not succeed: ${outcome ?? 'unknown'}`);
          return;
        }
        if (event.cursor) await save(state);
      }
      // The SDK ends an aborted stream cleanly; it is not a successful turn.
      checkResponseDeadline(signal);
    } catch (error) {
      checkResponseDeadline(signal);
      if (!state.inFlight || (error instanceof ZooworkError && error.status >= 400 && error.status < 500)) throw error;
      onProgress?.('Reconnecting to agent');
      console.error('Stream interrupted; reconnecting from the last processed cursor.');
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 15000)));
  }
  throw new Error('Stream disconnected repeatedly. Restart to resume the current turn.');
}
export async function chat(message: string, onEvent?: (event: SessionEvent) => void, context?: ChatContext, onProgress?: ProgressReporter) {
  if (!message.trim()) throw new Error('Empty message');
  // A gateway error may occur after accepting a write. Retry the persisted user
  // idempotency key before resuming, rather than creating a second run.
  if (state.pendingTurn) {
    onProgress?.('Recovering previous request');
    await submitTurn(client, agentId, sessionId, state.pendingTurn);
    state.inFlight = true;
    delete state.pendingTurn;
    await save(state);
  }
  if (state.inFlight) {
    const previousMessage = state.turnMessage;
    onProgress?.('Resuming previous response');
    await streamTurn(onEvent, onProgress);
    if (previousMessage?.trim() === message.trim()) return;
  }
  // Persist context and the delivery key before making the write, for recovery.
  state.turnContext = context;
  state.turnMessage = message;
  state.pendingTurn = { message, context, key: randomUUID() };
  await save(state);
  onProgress?.('Sending message to agent');
  await submitTurn(client, agentId, sessionId, state.pendingTurn);
  delete state.pendingTurn;
  onProgress?.('Waiting for agent response');
  state.inFlight = true; await save(state); await streamTurn(onEvent, onProgress);
}

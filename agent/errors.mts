import { ZooworkError } from '@zoowork-ai/sdk';
import { responseTimeoutMessage } from './progress.mts';

export function agentError(error: unknown): { code: string; message: string; status?: number } {
  if (error instanceof ZooworkError) {
    const suffix = error.type && /^[a-zA-Z0-9_.-]{1,100}$/.test(error.type) ? ` (${error.type})` : '';
    if (error.status === 401) return { code: 'zoowork_auth', status: 401, message: 'ZooWork rejected the API key. Check the backend ZOOWORK_API_KEY.' };
    if (error.status === 403) return { code: 'zoowork_access', status: 403, message: `ZooWork denied access${suffix}. Check project permissions.` };
    if (error.status === 402) return { code: 'zoowork_billing', status: 402, message: 'ZooWork requires billing or available credits. Check your ZooWork account.' };
    if (error.status === 429) return { code: 'zoowork_rate_limit', status: 429, message: 'ZooWork is rate-limiting requests. Wait briefly and retry.' };
    if (error.status >= 500) return { code: 'zoowork_gateway', status: error.status, message: `ZooWork returned HTTP ${error.status}${suffix}. Retry to recover the same request; do not submit a duplicate swap.` };
    return { code: 'zoowork_api', status: error.status, message: `ZooWork request failed: HTTP ${error.status}${suffix}. Check agent/session access.` };
  }
  const causeCode = (error as { cause?: { code?: unknown } })?.cause?.code;
  if (causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN') return { code: 'zoowork_dns', message: 'The backend cannot resolve the ZooWork API hostname. Check DNS or network access.' };
  if (causeCode === 'ECONNREFUSED' || causeCode === 'ETIMEDOUT' || causeCode === 'UND_ERR_CONNECT_TIMEOUT') return { code: 'zoowork_connection', message: 'The backend could not connect to ZooWork. Check network access and retry.' };
  if (error instanceof Error) {
    if (error.message === responseTimeoutMessage) return { code: 'response_timeout', message: responseTimeoutMessage };
    if (error.name === 'TimeoutError') return { code: 'request_timeout', message: 'The ZooWork request timed out. Retry to recover the same request.' };
    if (error.message.startsWith('Agent did not accept')) return { code: 'message_not_accepted', message: 'ZooWork did not acknowledge the message. Retry to recover the same request.' };
    if (error.message.startsWith('Run did not succeed:')) return { code: 'run_failed', message: 'The ZooWork agent run failed or was aborted. Check the session activity.' };
  }
  // Never relay raw exception messages, URLs, response bodies, or credentials.
  return { code: 'agent_unavailable', message: 'The agent is unavailable. Check the backend terminal for the failure stage.' };
}

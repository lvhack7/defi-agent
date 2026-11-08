import { assistantText } from '@zoowork-ai/sdk';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzePortfolio } from '../blockchain/valuation.mts';
import { calculateSwap } from '../blockchain/swap-calculator.mts';
import { getUsdcAllowance } from '../blockchain/allowance.mts';
import { prepareTrade, listTrades, requestSignature, declineTrade, recordTransaction, refreshTrade, prepareAfterApproval, ProposalRefreshRequired } from '../blockchain/execution.mts';
import { tradeInput } from './tools.mts';
import { networkName, networkConfig, executionEnabled } from '../blockchain/networks.mts';
import { policyFor } from '../blockchain/policy.mts';
import { parseChatContext } from './chat-context.mts';
import { agentError } from './errors.mts';
import type { Hex } from 'viem';
const port = Number(process.env.PORT ?? 3100);
const staticRoot = fileURLToPath(new URL('../client/dist', import.meta.url));
let busy = false;
const releaseLock = await (await import('./process-lock.mts')).acquireRuntimeLock();
// Warm the existing managed runtime while the dashboard is loading, rather than
// charging lifecycle/configuration work to the first chat request.
let agentReady = false;
let initializationFailure: ReturnType<typeof agentError> | undefined;
const initializationStarted = Date.now();
const runtime = import('./runtime.mts').then(module => {
  agentReady = true;
  console.log(`[agent] Runtime ready: ${Date.now() - initializationStarted}ms`);
  return module;
}).catch(error => {
  initializationFailure = agentError(error);
  console.error('[agent] Runtime initialization failed:', JSON.stringify(initializationFailure));
  return null;
});
createServer(async (req, res) => {
  try {
    const host = req.headers.host;
    if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) { res.writeHead(403).end(); return; }
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (!url.pathname.startsWith('/api/')) {
      const requested = resolve(staticRoot, '.' + url.pathname);
      if (requested !== staticRoot && !requested.startsWith(staticRoot + sep)) { res.writeHead(403).end(); return; }
      const file = extname(requested) ? requested : resolve(staticRoot, 'index.html');
      const data = await readFile(file);
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' } as Record<string,string>)[extname(file)] ?? 'application/octet-stream');
      res.end(data); return;
    }
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && url.pathname === '/api/agent-status') { res.end(JSON.stringify({ status: initializationFailure ? 'failed' : agentReady ? 'ready' : 'starting', busy, error: initializationFailure })); return; }
    if (req.method === 'GET' && url.pathname === '/api/config') { res.end(JSON.stringify(['base', 'mainnet', 'sepolia'].map(network => { const c = networkConfig(network), p = policyFor(networkName(network)); return { network, chainId: c.chain.id, name: c.chain.name, explorer: c.explorer, executionEnabled: executionEnabled(c.network), rpcConfigured: Boolean(process.env[c.rpcEnv]), maxTradeUsd: p.maxTradeUsd, maxGasUsd: p.maxGasUsd, walletDeadlineSeconds: p.deadlineSeconds }; }))); return; }
    if (req.method === 'GET' && url.pathname === '/api/trades') { res.end(JSON.stringify(await listTrades())); return; }
    if (req.method !== 'POST' || req.headers['x-defi-ui'] !== '1' || (req.headers.origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(req.headers.origin))) { res.writeHead(403).end('{}'); return; }
    let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 20000) throw new Error('Request too large'); }
    const body = JSON.parse(text);
    if (url.pathname === '/api/chat') {
      if (busy) { res.writeHead(409).end(JSON.stringify({ error: 'Agent is processing another message' })); return; }
      if (typeof body.message !== 'string' || body.message.length > 8000) throw new Error('Invalid message');
      const context = parseChatContext(body.context);
      busy = true;
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.flushHeaders();
      const started = Date.now();
      let stage = agentReady ? 'Connecting to agent' : 'Starting agent';
      const write = (value: unknown) => { if (!res.destroyed) res.write(JSON.stringify(value) + '\n'); };
      const report = () => write({ progress: { stage, elapsedSeconds: Math.floor((Date.now() - started) / 1000) } });
      const onProgress = (next: string) => {
        stage = next;
        console.log(`[agent] ${stage}: ${Date.now() - started}ms elapsed`);
        report();
      };
      report();
      const heartbeat = setInterval(report, 1000);
      try {
        const ready = await runtime;
        if (!ready) { write({ error: initializationFailure?.message ?? 'Agent initialization failed.', code: initializationFailure?.code }); return; }
        await ready.chat(body.message, event => write({ event, text: assistantText(event) }), context, onProgress);
        console.log(`[agent] Turn finished: ${Date.now() - started}ms`);
        write({ done: true });
      } catch (error) {
        const failure = agentError(error);
        console.error(`[agent] Turn failed at ${stage}: ${Date.now() - started}ms`, JSON.stringify(failure));
        write({ error: failure.message, code: failure.code });
      }
      finally { clearInterval(heartbeat); busy = false; res.end(); }
      return;
    }
    let result;
    switch (url.pathname) {
      case '/api/swap-preview': result = await calculateSwap(body); break;
      case '/api/usdc-allowance': result = await getUsdcAllowance(body); break;
      case '/api/portfolio': result = await analyzePortfolio({ wallet: body.wallet, network: networkName(body.network) }); break;
      case '/api/prepare': result = await prepareTrade(tradeInput({ wallet: body.wallet, network: body.network, tokenIn: body.tokenIn, amount: body.amount, slippageBps: body.slippageBps, ...(body.approvalOnly === true ? {approvalOnly:true} : {}) })); break;
      case '/api/signature': result = await requestSignature(body.id, body.wallet); break;
      case '/api/refresh-proposal': result = await refreshTrade(body.id, body.wallet); break;
      case '/api/continue-approval': result = await prepareAfterApproval(body.id, body.wallet); break;
      case '/api/decline': result = await declineTrade(body.id); break;
      case '/api/receipt': result = await recordTransaction(body.id, body.hash as Hex); break;
      default: res.writeHead(404).end('{}'); return;
    }
    res.end(JSON.stringify(result));
  } catch (error) {
    if (error instanceof ProposalRefreshRequired) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message, code: error.code })); return; }
    if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'application/json' });
    const message = error instanceof Error && /^(Real-money execution|Execution was disabled|Connected wallet|Proposal expired|Fresh validation|Quote changed|Network, recipient|This proposal|Validation did not pass|Invalid|Unknown input)/.test(error.message) ? error.message : 'Request failed. Check input, proposal status, expiry and RPC availability.';
    res.end(JSON.stringify({ error: message }));
  }
}).on('error', async () => { await releaseLock(); console.error('Cannot start local server; check port availability and local permissions.'); process.exitCode = 1; }).listen(port, '127.0.0.1', () => console.log(`DeFi Autopilot: http://localhost:${port}`));

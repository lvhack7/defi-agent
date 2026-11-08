import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { createPublicClient, http, decodeEventLog, parseAbi, type Hex, type Address } from 'viem';
import { networkConfig, networkName, networkFromChainId, rpcFor, executionEnabled } from './networks.mts';
import { validateUsdcSwap } from './reverse-validation.mts';
import { validateSwap } from './validation.mts';
import { getPortfolio } from './portfolio.mts';
import { policyFor } from './policy.mts';
import type { ReviewedTerms } from './trade-validation.mts';
const dir = new URL('./.trades/', import.meta.url);
type Validation = Awaited<ReturnType<typeof validateSwap>> | Awaited<ReturnType<typeof validateUsdcSwap>>;
async function assess(input: unknown, reviewed?: ReviewedTerms) {
  const v = input as Record<string, unknown>;
  if (v && typeof v === 'object' && 'amountUsdc' in v) { const { approvalOnly, ...trade } = v; if (approvalOnly !== undefined && approvalOnly !== true) throw new Error('Invalid approval flag'); return validateUsdcSwap(trade, approvalOnly === true, reviewed); }
  return validateSwap(input, reviewed);
}
export type Trade = { id: string; createdAt: string; input: unknown; validation: Validation; status: 'rejected' | 'prepared' | 'superseded' | 'awaiting_wallet' | 'submitted' | 'confirmed' | 'reverted' | 'wallet_declined' | 'verification_failed' | 'verification_pending'; replacementId?: string; hash?: Hex; result?: unknown };
export class ProposalRefreshRequired extends Error {
  code = 'proposal_refresh_required';
  constructor(message: string) { super(message); this.name = 'ProposalRefreshRequired'; }
}
const path = (id: string) => { if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid trade ID'); return new URL(`${id}.json`, dir); };
let queue = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> { const result = queue.then(fn); queue = result.then(() => {}, () => {}); return result; }
async function save(trade: Trade) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = new URL(`${trade.id}.tmp`, dir);
  await writeFile(temp, JSON.stringify(trade, null, 2), { mode: 0o600 });
  await rename(temp, path(trade.id));
}
export async function getTrade(id: string): Promise<Trade> { return JSON.parse(await readFile(path(id), 'utf8')); }
export async function listTrades() {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const trades = await Promise.all((await readdir(dir)).filter(x => x.endsWith('.json')).map(x => getTrade(x.slice(0, -5))));
  return trades.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function buildTrade(input: unknown, idempotencyKey: string) {
    const id = createHash('sha256').update(idempotencyKey).digest('hex');
    try { return await getTrade(id); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid trade input');
    const normalized = { ...input, network: networkName((input as Record<string, unknown>).network) };
    const validation = await assess(normalized);
    const trade: Trade = { id, createdAt: new Date().toISOString(), input: normalized, validation, status: validation.status === 'approved' && 'transaction' in validation && validation.transaction ? 'prepared' : 'rejected' };
    await save(trade); return trade;
}
export function prepareTrade(input: unknown, idempotencyKey: string = randomUUID()) {
  return serial(() => buildTrade(input, idempotencyKey));
}
// An approval is not a swap. The explicit continuation creates a new validated
// proposal for the same amount; it never requests or sends a wallet transaction.
export function prepareAfterApproval(id: string, wallet: string) {
  return serial(async () => {
    const approval = await getTrade(id);
    const input = approval.input as Record<string, unknown>;
    if (typeof input.wallet !== 'string' || typeof wallet !== 'string' || input.wallet.toLowerCase() !== wallet.toLowerCase()) throw new Error('Connected wallet does not match approval');
    if (approval.status !== 'confirmed' || !('kind' in approval.validation) || approval.validation.kind !== 'usdc_approval' || typeof input.amountUsdc !== 'string') throw new Error('This proposal requires a confirmed USDC approval before continuing');
    const { approvalOnly: _approvalOnly, ...swap } = input;
    return buildTrade(swap, `swap-after-approval:${id}`);
  });
}
// Refresh only an unreleased proposal. The replacement must be reviewed and
// signed separately; this action never releases a transaction to a wallet.
export function refreshTrade(id: string, wallet: string) {
  return serial(async () => {
    const trade = await getTrade(id);
    const input = trade.input as { wallet?: unknown };
    if (typeof input.wallet !== 'string' || input.wallet.toLowerCase() !== wallet.toLowerCase()) throw new Error('Connected wallet does not match proposal');
    if (trade.status === 'superseded' && trade.replacementId) return getTrade(trade.replacementId);
    if (trade.status !== 'prepared') throw new Error('This proposal cannot be refreshed after wallet release; inspect its status first.');
    const replacement = await buildTrade(trade.input, `refresh:${trade.id}`);
    trade.status = 'superseded'; trade.replacementId = replacement.id;
    await save(trade);
    return replacement;
  });
}
// The agent cannot call this: it is the dashboard's explicit wallet-approval action.
export function requestSignature(id: string, wallet: string) {
  return serial(async () => {
    const trade = await getTrade(id);
    if (trade.status !== 'prepared') throw new Error('This proposal cannot be submitted again; inspect its status before creating another.');
    const v = trade.validation;
    if (v.status !== 'approved' || !('transaction' in v) || !v.transaction) throw new Error('Validation did not pass');
    if (!executionEnabled(networkFromChainId(v.transaction.chainId))) throw new Error('Real-money execution is disabled for this network.');
    if (v.transaction.from.toLowerCase() !== wallet.toLowerCase()) throw new Error('Connected wallet does not match proposal');
    const network = networkFromChainId(v.transaction.chainId);
    if (!Number.isFinite(Date.parse(trade.createdAt)) || Date.now() - Date.parse(trade.createdAt) >= policyFor(network).maxProposalAgeMs || Date.now() >= v.transaction.expiresAt) throw new ProposalRefreshRequired('Proposal expired. Refresh and review the current terms.');
    if (!('quote' in v) || !v.quote.pool || v.quote.feeTier === undefined || !('minimumOut' in v)) throw new Error('Validation did not include reviewed swap terms');
    // Fresh quote and simulation, same input/route and exact reviewed minimum.
    // Normal quote movement within that floor does not require re-approval.
    const fresh = await assess(trade.input, { pool: v.quote.pool as Address, feeTier: v.quote.feeTier, minimumOut: v.minimumOut });
    if (fresh.status !== 'approved' || !('transaction' in fresh) || !fresh.transaction) throw new ProposalRefreshRequired('Fresh validation requires an updated proposal for review.');
    if (!fresh.executionEnabled || fresh.transaction.chainId !== v.transaction.chainId || fresh.transaction.from.toLowerCase() !== v.transaction.from.toLowerCase() || fresh.transaction.to.toLowerCase() !== v.transaction.to.toLowerCase() || fresh.transaction.value !== v.transaction.value) throw new Error('Network, recipient or execution permissions changed');
    if (!('quote' in fresh) || fresh.quote.pool !== v.quote.pool || fresh.quote.feeTier !== v.quote.feeTier || fresh.minimumOut !== v.minimumOut) throw new ProposalRefreshRequired('Route or minimum output changed. Review an updated proposal.');
    if (!executionEnabled(networkFromChainId(fresh.transaction.chainId))) throw new Error('Execution was disabled during validation');
    trade.validation = fresh; trade.status = 'awaiting_wallet'; await save(trade);
    return fresh.transaction;
  });
}
export function declineTrade(id: string) { return serial(async () => { const t = await getTrade(id); if (t.status !== 'awaiting_wallet') throw new Error('Unexpected trade status'); t.status = 'wallet_declined'; await save(t); return t; }); }
export function recordTransaction(id: string, hash: Hex) {
  return serial(async () => {
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error('Invalid transaction hash');
    const trade = await getTrade(id);
    if (trade.hash && trade.hash !== hash) throw new Error('Trade already has a different transaction');
    if (!['awaiting_wallet', 'submitted', 'confirmed', 'reverted', 'verification_failed', 'verification_pending'].includes(trade.status)) throw new Error('Trade was not released to the wallet');
    const validation = trade.validation;
    if (!('transaction' in validation) || !validation.transaction) throw new Error('Missing transaction');
    const expected = validation.transaction;
    const network = networkFromChainId(expected.chainId), config = networkConfig(network);
    const { chain, usdc, weth, router } = config;
    if (![usdc.toLowerCase(), router.toLowerCase()].includes(expected.to.toLowerCase())) throw new Error('Unknown transaction target');
    const client = createPublicClient({ chain, transport: http(rpcFor(network)) });
    if (await client.getChainId() !== chain.id) throw new Error('Wrong RPC chain');
    const tx = await client.getTransaction({ hash });
    if (tx.from.toLowerCase() !== expected.from.toLowerCase() || tx.to?.toLowerCase() !== expected.to.toLowerCase() || tx.input !== expected.data || tx.value !== BigInt(expected.value) || (!('chainId' in tx) || tx.chainId !== chain.id)) throw new Error('Transaction does not match the validated proposal');
    trade.hash = hash; trade.status = 'submitted'; await save(trade);
    let receipt;
    try { receipt = await client.getTransactionReceipt({ hash }); } catch { return trade; }
    trade.status = receipt.status === 'success' ? 'confirmed' : 'reverted';
    let received = 0n, unwrapped = 0n, poolInput = 0n;
    const reverse = 'quote' in validation && validation.quote.tokenOut === 'ETH';
    const approval = 'kind' in validation && validation.kind === 'usdc_approval';
    for (const log of receipt.logs) {
      if ('quote' in validation && log.address.toLowerCase() === validation.quote.pool.toLowerCase()) {
        try {
          const event = decodeEventLog({ abi: parseAbi(['event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)']), data: log.data, topics: log.topics });
          const inputAddress = reverse ? usdc : weth;
          const token0 = usdc.toLowerCase() < weth.toLowerCase() ? usdc : weth;
          const actualInput = inputAddress.toLowerCase() === token0.toLowerCase() ? event.args.amount0 : event.args.amount1;
          if (event.args.sender.toLowerCase() === router.toLowerCase() && actualInput > 0n) poolInput += actualInput;
        } catch { /* unrelated event */ }
      }
      if (log.address.toLowerCase() === weth.toLowerCase()) {
        try { const event = decodeEventLog({ abi: parseAbi(['event Withdrawal(address indexed src,uint256 wad)']), data: log.data, topics: log.topics }); if (event.args.src.toLowerCase() === expected.to.toLowerCase()) unwrapped += event.args.wad; } catch { /* unrelated event */ }
      }
      if (log.address.toLowerCase() !== usdc.toLowerCase()) continue;
      try {
        const event = decodeEventLog({ abi: parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']), data: log.data, topics: log.topics });
        if (event.args.to.toLowerCase() === expected.from.toLowerCase()) received += event.args.value;
      } catch { /* unrelated event */ }
    }
    const minimum = 'minimumOut' in validation ? (await import('viem')).parseUnits(validation.minimumOut, reverse ? 18 : 6) : 0n;
    const outputVerified = approval || (reverse ? unwrapped : received) >= minimum;
    const expectedInput = 'quote' in validation ? (await import('viem')).parseUnits(validation.quote.amountIn as string, reverse ? 6 : 18) : 0n;
    const inputVerified = approval || poolInput === expectedInput;
    if (receipt.status === 'success' && (!outputVerified || !inputVerified)) trade.status = 'verification_failed';
    trade.result = { inputVerified, outputVerified, wethUnwrappedRaw: unwrapped.toString(), blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), usdcReceivedRaw: received.toString(), receiptStatus: receipt.status };
    await save(trade);
    try {
      const portfolio = await getPortfolio({ wallet: expected.from, network, includeUsdc: true }, undefined, receipt.blockNumber);
      const balancesVerified = portfolio.tokens[0]?.rawBalance !== undefined;
      const head = await client.getBlockNumber({ cacheTime: 0 });
      const confirmations = head >= receipt.blockNumber ? Number(head - receipt.blockNumber + 1n) : 0;
      trade.result = { ...(trade.result as object), portfolio, balancesVerified, confirmations };
      if (trade.status === 'confirmed' && (!balancesVerified || confirmations < 2)) trade.status = 'verification_pending';
      await save(trade);
    } catch { if (trade.status === 'confirmed') trade.status = 'verification_pending'; await save(trade); }
    return trade;
  });
}

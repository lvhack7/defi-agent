import type { CustomToolDeclaration } from '@zoowork-ai/sdk';
import { getPortfolio } from '../blockchain/portfolio.mts';
import { analyzePortfolio } from '../blockchain/valuation.mts';
import { quoteSwap, proposeRebalance } from '../blockchain/uniswap.mts';
import { validateTrade } from '../blockchain/trade-validation.mts';
import { prepareTrade, getTrade } from '../blockchain/execution.mts';
import { networkName } from '../blockchain/networks.mts';
import { toolInputWithContext, type ChatContext } from './chat-context.mts';
import { calculateSwap } from '../blockchain/swap-calculator.mts';
const network = { type: 'string', enum: ['base', 'mainnet', 'sepolia'], description: 'Defaults to the selected dashboard network; required in the CLI.' };
const wallet = { type: 'string', description: 'Defaults to the active dashboard wallet; do not ask the user to repeat a connected wallet address.' }, amount = { type: 'string', description: 'Positive decimal token amount' };
const slippageBps = { type: 'integer', minimum: 0, maximum: 100 };
function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): CustomToolDeclaration {
  return { name, description, input_schema: { type: 'object', properties, required: required.filter(field => field !== 'wallet' && field !== 'network'), additionalProperties: false } };
}
export const personaText = 'You are DeFi Autopilot. Use the current dashboard context for the active wallet and selected network: base (Base Mainnet, 8453), mainnet (Ethereum, 1), or sepolia (testnet). Users do not need to type a wallet address or network when these are supplied by the dashboard. Never guess a wallet or reuse a previous wallet/network after context changes or disconnection. Tool wallet/network fields default to the current dashboard context. Balance analysis and trade preparation require an active wallet; ask the user to connect one or enter a watch address only for those requests. Quotes and swap calculations need no wallet. In the CLI, ask for a network when missing, and a wallet only for wallet-specific tools. For questions like "how much ETH do I have and what is it worth", call analyze_portfolio for fresh balances and pricing, then answer concisely with the ETH amount, ETH asset valueUsd and selected network; do not confuse total portfolio value with ETH value. Mainnet valuation uses fresh CoinGecko USD prices; swaps use on-chain Uniswap quotes. Sepolia uses test USDC pool prices and has no real USD valuation. For amount-based swap questions, call calculate_swap using the selected network and user token amount. Report expected output, effective rate, minimum received at the chosen slippage and included pool fee. Use the actual Uniswap output, not a CoinGecko multiplication. USD values are references only; do not claim the pool quote is a guaranteed fill or the pool fee is the network gas cost. A hypothetical calculation must not prepare a trade. USDC-to-ETH swaps may require two separate manually signed transactions: exact-amount USDC spending approval, then the swap. If prepare_trade reports approvalRequired, explain the allowance check and prepare only the required approval with approvalOnly true. A confirmed usdc_approval is spending permission only; it does not exchange USDC or deliver ETH. After approval confirms, prepare a fresh USDC-to-ETH swap with approvalOnly omitted and the same user-requested amount, unless the user changes it. Reuse sufficient existing allowance; never ask for repeated approvals without checking validation. Never report an approval receipt as a completed swap. For a user-requested actual swap, show the calculation and use prepare_trade for full validation and network fees before manual wallet signing. There is no fixed allocation target or required ETH/USDC ratio. Follow the swap token, direction and amount requested by the user; do not impose a target from earlier conversation history. Only propose a rebalance when requested, using a target explicitly chosen by the user. Ask for a target only if the user requests a rebalance without specifying one; a direct swap request needs no allocation target. Prepare trades only on the selected dashboard network (or the explicitly requested CLI network). Mainnet execution is disabled unless the local backend is explicitly enabled, and every transaction requires manual Trust Wallet approval. Dashboard wallet context is not proof of ownership or signing authorization. Never claim execution without verified on-chain evidence. Tools cannot sign or enable execution.';
export const toolDeclarations: CustomToolDeclaration[] = [
  tool('portfolio_capabilities', 'Describe supported networks and execution requirements', {}, []),
  tool('calculate_swap', 'Read-only exact-input ETH/USDC calculator using a fresh Uniswap quote. Returns output, exchange rate, slippage minimum, included pool fee and optional USD reference values. Requires no wallet and creates no transaction or proposal. Use for how-much-would-I-get questions and before preparing a requested swap.', { network, tokenIn: { type: 'string', enum: ['ETH', 'USDC'] }, amount, slippageBps }, ['network', 'tokenIn', 'amount']),
  tool('get_portfolio', 'Read ETH and explicitly selected ERC-20 balances; includeUsdc selects native Circle USDC on the requested chain', { network, wallet, includeUsdc: { type: 'boolean' }, tokens: { type: 'array', items: { type: 'string' }, maxItems: 20 } }, ['network', 'wallet']),
  tool('analyze_portfolio', 'Analyze ETH/USDC allocations with CoinGecko USD prices on Base/Ethereum mainnet, or testnet pool prices on Sepolia', { network, wallet, targetEthPercent: { type: 'number', minimum: 0, maximum: 100 } }, ['network', 'wallet']),
  tool('quote_swap', 'Read-only Uniswap v3 exact-input ETH/USDC quote on the explicitly selected network', { network, tokenIn: { type: 'string', enum: ['ETH', 'USDC'] }, amount }, ['network', 'tokenIn', 'amount']),
  tool('propose_rebalance', 'For a user-requested rebalance only: estimate size for their explicitly chosen target and request a real quote. Never assume a fixed target. Does not prepare or submit a transaction.', { network, wallet, targetEthPercent: { type: 'number', minimum: 0, maximum: 100 } }, ['network', 'wallet', 'targetEthPercent']),
  ...['validate_swap', 'prepare_trade'].map(name => tool(name, name === 'prepare_trade' ? 'Validate and persist a trade for manual wallet approval. Mainnet execution remains locked by default. approvalOnly prepares exact USDC allowance.' : 'Validate a trade without signing or submitting.', { network, wallet, tokenIn: { type: 'string', enum: ['ETH', 'USDC'] }, amount, slippageBps, approvalOnly: { type: 'boolean' } }, ['network', 'wallet', 'tokenIn', 'amount', 'slippageBps'])),
  tool('get_trade_status', 'Read persisted proposal and verified chain results', { id: { type: 'string' } }, ['id']),
  tool('quote_sepolia_swap', 'Legacy Sepolia-only quote', { tokenIn: { type: 'string', enum: ['ETH', 'USDC'] }, amount }, ['tokenIn', 'amount']),
  tool('propose_sepolia_rebalance', 'Legacy Sepolia-only rebalance', { wallet, targetEthPercent: { type: 'number' } }, ['wallet', 'targetEthPercent']),
  ...['validate_sepolia_swap', 'prepare_sepolia_trade'].map(name => tool(name, 'Legacy Sepolia-only ETH-to-USDC proposal/validation', { wallet, amountEth: amount, slippageBps }, ['wallet', 'amountEth', 'slippageBps'])),
  tool('prepare_sepolia_usdc_trade', 'Legacy Sepolia-only USDC-to-ETH proposal', { wallet, amountUsdc: amount, slippageBps, approvalOnly: { type: 'boolean' } }, ['wallet', 'amountUsdc', 'slippageBps']),
];
export function tradeInput(v: Record<string, unknown>) {
  if (Object.keys(v).some(k => !['wallet', 'network', 'tokenIn', 'amount', 'slippageBps', 'approvalOnly'].includes(k))) throw new Error('Unknown trade field');
  if (v.network === undefined || !['ETH', 'USDC'].includes(String(v.tokenIn)) || v.approvalOnly !== undefined && typeof v.approvalOnly !== 'boolean') throw new Error('Invalid trade parameters');
  return { wallet: v.wallet, network: networkName(v.network), slippageBps: v.slippageBps, ...(v.tokenIn === 'ETH' ? { amountEth: v.amount } : { amountUsdc: v.amount }), ...(v.approvalOnly === true ? { approvalOnly: true } : {}) };
}
export async function handleTool(name: string | undefined, input: Record<string, unknown> | undefined, key: string, context?: ChatContext) {
  const v = toolInputWithContext(name, input, context);
  switch (name) {
    case 'calculate_swap': return calculateSwap(v);
    case 'portfolio_capabilities': return { networks: ['base', 'mainnet', 'sepolia'], prices: 'CoinGecko on mainnets; pool spot on Sepolia', approval: 'Manual Trust Wallet approval per transaction; real-money execution locked by default' };
    case 'get_portfolio': return getPortfolio(v);
    case 'analyze_portfolio': return analyzePortfolio(v);
    case 'quote_swap': if (!v.network) throw new Error('Network is required'); return quoteSwap(v);
    case 'propose_rebalance': if (!v.network) throw new Error('Network is required'); return proposeRebalance(v);
    case 'validate_swap': { const { approvalOnly, ...trade } = tradeInput(v); return validateTrade(trade, approvalOnly === true); }
    case 'prepare_trade': return prepareTrade(tradeInput(v), key);
    case 'get_trade_status': if (typeof v.id !== 'string' || Object.keys(v).some(k => k !== 'id')) throw new Error('Invalid trade ID'); return getTrade(v.id);
    case 'quote_sepolia_swap': return quoteSwap({ ...v, network: 'sepolia' });
    case 'propose_sepolia_rebalance': return proposeRebalance({ ...v, network: 'sepolia' });
    case 'validate_sepolia_swap': return validateTrade({ ...v, network: 'sepolia' });
    case 'prepare_sepolia_trade': case 'prepare_sepolia_usdc_trade': return prepareTrade({ ...v, network: 'sepolia' }, key);
    default: throw new Error('Unknown tool');
  }
}

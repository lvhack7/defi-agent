import type { OutboundEvent } from '@zoowork-ai/sdk';
import { getAddress, isAddress, type Address } from 'viem';
import { networkConfig, networkName, type Network } from '../blockchain/networks.mts';

export type ChatContext = {
  network: Network;
  wallet: Address | null;
  walletSource: 'connected' | 'watch' | 'none';
};

export function parseChatContext(input: unknown): ChatContext {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid chat context');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['network', 'wallet', 'walletSource'].includes(key)) || value.network === undefined) throw new Error('Invalid chat context');
  const network = networkName(value.network);
  if (!['connected', 'watch', 'none'].includes(String(value.walletSource))) throw new Error('Invalid wallet context');
  if (value.wallet == null || value.wallet === '') {
    if (value.walletSource !== 'none') throw new Error('Invalid wallet context');
    return { network, wallet: null, walletSource: 'none' };
  }
  if (typeof value.wallet !== 'string' || !isAddress(value.wallet.trim()) || value.walletSource === 'none') throw new Error('Invalid wallet address');
  return { network, wallet: getAddress(value.wallet.trim()), walletSource: value.walletSource as 'connected' | 'watch' };
}

export function chatEvents(message: string, context: ChatContext | undefined, idempotencyKey: string): OutboundEvent[] {
  const note = context
    ? `Current dashboard context for this turn (replaces previous wallet/network context): ${JSON.stringify({ ...context, chainId: networkConfig(context.network).chain.id })}. Use this wallet and network for "my", "I", balances, valuations and swaps without asking the user to repeat them. If wallet is null, quotes and swap calculations may still run. Ask for a wallet only when balances or trade preparation require one; never reuse a wallet from an earlier turn. For ETH amount and USD value, call analyze_portfolio and use the ETH balance and ETH asset valueUsd. Sepolia is test USDC valuation, not real USD. There is no mandatory allocation target. Follow the swap amount and token direction in the current user message; never impose an earlier standing ratio. This context is not signing authorization; every transaction still needs validation and manual wallet approval.`
    : 'This turn is from the CLI, without dashboard wallet/network context. Do not reuse an earlier dashboard wallet or network. Use the wallet and network supplied by the user; ask only for missing information.';
  return [
    // The deployed system.message writer currently persists a note then returns
    // HTTP 502, including in an ordered batch. Use the supported user-message
    // text input for application context; scope is still enforced in tools.
    { type: 'user.message', content: `[Application context]\n${note}\n\n[User message]\n${message}`, idempotency_key: idempotencyKey },
  ];
}

const networkTools = new Set(['get_portfolio', 'analyze_portfolio', 'calculate_swap', 'quote_swap', 'propose_rebalance', 'validate_swap', 'prepare_trade']);
const walletTools = new Set(['get_portfolio', 'analyze_portfolio', 'propose_rebalance', 'validate_swap', 'prepare_trade', 'propose_sepolia_rebalance', 'validate_sepolia_swap', 'prepare_sepolia_trade', 'prepare_sepolia_usdc_trade']);
const sepoliaTools = new Set(['quote_sepolia_swap', 'propose_sepolia_rebalance', 'validate_sepolia_swap', 'prepare_sepolia_trade', 'prepare_sepolia_usdc_trade']);

export function toolInputWithContext(name: string | undefined, input: Record<string, unknown> | undefined, context?: ChatContext): Record<string, unknown> {
  const value = { ...input };
  if (!name) return value;
  if (networkTools.has(name)) {
    if (context) {
      if (value.network !== undefined && value.network !== context.network) throw new Error('Invalid tool network: use the network selected in the dashboard');
      value.network = context.network;
    }
    if (value.network === undefined) throw new Error('Invalid tool network: specify a network');
  }
  if (context && sepoliaTools.has(name) && context.network !== 'sepolia') throw new Error('Invalid tool network: legacy Sepolia tools cannot use the selected network');
  if (walletTools.has(name) && context) {
    if (!context.wallet) throw new Error('Invalid wallet context: connect a wallet or enter a watch address');
    if (value.wallet !== undefined && (typeof value.wallet !== 'string' || value.wallet.toLowerCase() !== context.wallet.toLowerCase())) throw new Error('Invalid tool wallet: use the active dashboard wallet');
    value.wallet = context.wallet;
  }
  return value;
}

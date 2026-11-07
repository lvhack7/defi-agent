import { createPublicClient, http, parseAbi, encodeFunctionData, decodeFunctionResult, parseUnits, formatUnits, isAddress, getAddress, type Hex } from 'viem';
import { readBaseFeeComponents } from './base-fees.mts';
import { validationFailure } from './validation-errors.mts';
import { networkConfig, networkName, rpcFor } from './networks.mts';
import { policyFor } from './policy.mts';
import { getPortfolio } from './portfolio.mts';
import { quoteSwap } from './uniswap.mts';
import { getPricing, pricingFresh } from './prices.mts';
const routerAbi = parseAbi(['function allowance(address owner,address spender) view returns (uint256)', 'function approve(address spender,uint256 amount) returns (bool)', 'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)', 'function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)', 'function unwrapWETH9(uint256 amountMinimum,address recipient) payable', 'function refundETH() payable']);
export type Check = { name: string; passed: boolean; explanation: string };
export async function validateTrade(input: unknown, approvalOnly = false) {
  const checks: Check[] = [];
  const add = (name: string, passed: boolean, explanation: string) => checks.push({ name, passed, explanation });
  const reject = (message: string) => ({ status: 'rejected' as const, executionEnabled: false, checks, message });
  let stage = 'input_validation';
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return reject('Input must be an object');
    const v = input as Record<string, unknown>;
    if (Object.keys(v).some(k => !['wallet', 'network', 'amountEth', 'amountUsdc', 'slippageBps'].includes(k))) return reject('Unknown input field');
    if (typeof v.wallet !== 'string' || !isAddress(v.wallet)) return reject('Invalid wallet address');
    const network = networkName(v.network), config = networkConfig(network), policy = policyFor(network);
    const { chain, router, weth, usdc } = config;
    const reverse = v.amountUsdc !== undefined;
    if (reverse && v.amountEth !== undefined) return reject('Specify exactly one input token');
    if (approvalOnly && !reverse) return reject('Only USDC approvals are supported');
    const tokenIn = reverse ? 'USDC' : 'ETH', decimals = reverse ? 6 : 18, amountText = reverse ? v.amountUsdc : v.amountEth;
    if (typeof amountText !== 'string' || amountText.length > 80 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(amountText) || (amountText.split('.')[1]?.length ?? 0) > decimals) return reject('Invalid input amount');
    const amount = parseUnits(amountText, decimals);
    if (amount <= 0n || amount >= 2n ** 256n) return reject('Invalid input amount');
    if (!Number.isInteger(v.slippageBps) || (v.slippageBps as number) < 0 || (v.slippageBps as number) > policy.maxSlippageBps) { add('slippage', false, `Allowed slippage: 0–${policy.maxSlippageBps} bps`); return reject('Invalid slippage'); }
    add('slippage', true, `${v.slippageBps} basis points`);
    const wallet = getAddress(v.wallet), rpc = rpcFor(network);
    const client = createPublicClient({ chain, transport: http(rpc, { timeout: 10000, retryCount: 1 }) });
    stage = 'network';
    if (await client.getChainId() !== chain.id) { add('network', false, 'RPC returned a different chain ID'); return reject('Wrong RPC chain'); }
    stage = 'portfolio';
    const portfolio = await getPortfolio({ wallet, network, includeUsdc: true });
    const usdcBalance = portfolio.tokens[0];
    if (!usdcBalance || usdcBalance.error || usdcBalance.rawBalance === undefined || usdcBalance.decimals !== 6) return reject('USDC balance or verified metadata unavailable');
    const ethRaw = BigInt(portfolio.native.rawBalance), usdcRaw = BigInt(usdcBalance.rawBalance);
    if ((reverse ? usdcRaw : ethRaw) < amount) return reject('Insufficient input balance');
    stage = 'quote';
    const quote = await quoteSwap({ network, tokenIn, amount: amountText });
    if (quote.status !== 'quoted' || quote.amountOut === undefined || quote.feeTier === undefined || !quote.quotedAt) return reject('Quote unavailable');
    stage = 'pricing';
    const pricing = await getPricing(network, quote.pool), price = parseUnits(pricing.usdcPerEth, 8);
    const ethUsd = pricing.ethUsd ? parseUnits(pricing.ethUsd, 8) : 0n, usdcUsd = pricing.usdcUsd ? parseUnits(pricing.usdcUsd, 8) : 0n;
    const amountOut = parseUnits(quote.amountOut, reverse ? 18 : 6), minOut = amountOut * BigInt(10000 - (v.slippageBps as number)) / 10000n;
    if (amountOut <= 0n || minOut <= 0n) return reject('Invalid minimum output');
    const inputUsd = reverse ? amount * usdcUsd / 1000000n : amount * ethUsd / 10n ** 18n;
    add('trade_limit', network === 'sepolia' || inputUsd <= parseUnits(policy.maxTradeUsd, 8), network === 'sepolia' ? 'No real-money notional limit on testnet' : `Input value ${formatUnits(inputUsd, 8)} USD; limit ${policy.maxTradeUsd} USD`);
    const implied = reverse ? amount * 100000000n * 10n ** 18n / (amountOut * 1000000n) : amountOut * 100000000n * 10n ** 18n / (amount * 1000000n);
    const diff = implied > price ? implied - price : price - implied;
    add('price_deviation', diff * 100n <= price * BigInt(policy.maxDeviationPercent), `Quote ${formatUnits(implied, 8)} USDC/ETH versus ${pricing.usdcPerEth} (${pricing.source}); limit ${policy.maxDeviationPercent}%`);
    add('full_input_verification', quote.fullInputConsumed === true, 'Quoter post-swap price must remain strictly inside default limits');
    const allocationValues = (received: bigint, gas: bigint) => {
      const e = ethRaw - (reverse ? 0n : amount) + (reverse ? received : 0n) - gas;
      const u = usdcRaw - (reverse ? amount : 0n) + (reverse ? 0n : received);
      if (e < 0n || u < 0n) return null;
      const ev = e * price / 10n ** 18n, uv = u * 100000000n / 1000000n;
      return ev + uv === 0n ? null : { ethValue: ev, totalValue: ev + uv };
    };
    const allocation = (received: bigint, gas: bigint) => { const values = allocationValues(received, gas); return values ? Number(values.ethValue * 1000000n / values.totalValue) / 10000 : null; };
    const deadline = BigInt(Math.floor((Date.parse(quote.quotedAt) + policy.maxQuoteAgeMs) / 1000));
    const swap = encodeFunctionData({ abi: routerAbi, functionName: 'exactInputSingle', args: [{ tokenIn: reverse ? usdc : weth, tokenOut: reverse ? weth : usdc, fee: quote.feeTier, recipient: reverse ? router : wallet, amountIn: amount, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] });
    const finish = reverse ? encodeFunctionData({ abi: routerAbi, functionName: 'unwrapWETH9', args: [minOut, wallet] }) : encodeFunctionData({ abi: routerAbi, functionName: 'refundETH' });
    const data = approvalOnly ? encodeFunctionData({ abi: routerAbi, functionName: 'approve', args: [router, amount] }) : encodeFunctionData({ abi: routerAbi, functionName: 'multicall', args: [deadline, [swap, finish]] });
    const value = reverse ? 0n : amount, to = approvalOnly ? usdc : router;
    if (reverse && !approvalOnly) {
      stage = 'allowance';
      const allowance = await client.readContract({ address: usdc, abi: routerAbi, functionName: 'allowance', args: [wallet, router] });
      if (allowance < amount) { add('allowance', false, 'Exact-amount USDC allowance required before swap simulation'); return { ...reject('USDC allowance required'), approvalRequired: true }; }
    }
    const tx = { account: wallet, to, data, value } as const;
    stage = 'simulation_and_gas';
    const [simulation, estimate, fees] = await Promise.all([client.call(tx), client.estimateGas(tx), client.estimateFeesPerGas()]);
    if (!simulation.data) return reject('Empty simulation result');
    if (approvalOnly) add('simulation', decodeFunctionResult({ abi: routerAbi, functionName: 'approve', data: simulation.data }) === true, 'Exact-amount USDC approval simulation');
    else {
      const results = decodeFunctionResult({ abi: routerAbi, functionName: 'multicall', data: simulation.data }) as readonly Hex[];
      const actual = decodeFunctionResult({ abi: routerAbi, functionName: 'exactInputSingle', data: results[0] });
      add('simulation', actual === amountOut && actual >= minOut, 'Router simulation must match the quote and satisfy minimum output');
    }
    const gas = estimate * 120n / 100n, maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice, priority = fees.maxPriorityFeePerGas ?? 0n;
    if (maxFeePerGas === undefined || maxFeePerGas < priority) return reject('Invalid fee estimate');
    let gasBudget = gas * maxFeePerGas;
    let baseFees: { l1Fee: bigint; operatorFee: bigint } | undefined;
    if (network === 'base') {
      stage = 'base_fees';
      baseFees = await readBaseFeeComponents(client, tx, gas);
      const total = baseFees.l1Fee + baseFees.operatorFee + gas * maxFeePerGas;
      const paddedTotal = total * 120n / 100n;
      gasBudget += paddedTotal; // Deliberately conservative: max-fee L2 budget plus padded all-in estimate.
    }
    add('gas_reserve', ethRaw - value >= gasBudget + policy.minGasReserveWei, `Budget ${formatUnits(gasBudget, 18)} ETH plus reserve ${formatUnits(policy.minGasReserveWei, 18)} ETH`);
    const gasUsd = gasBudget * ethUsd / 10n ** 18n;
    add('gas_limit', network === 'sepolia' || gasUsd <= parseUnits(policy.maxGasUsd, 8), network === 'sepolia' ? 'Testnet gas estimate only' : `Estimated gas budget ${formatUnits(gasUsd, 8)} USD; limit ${policy.maxGasUsd} USD`);
    const percentages = [allocation(amountOut, 0n), allocation(minOut, 0n), allocation(amountOut, gasBudget), allocation(minOut, gasBudget)];
    add('post_swap_balances', [allocationValues(amountOut, 0n), allocationValues(minOut, 0n), allocationValues(amountOut, gasBudget), allocationValues(minOut, gasBudget)].every(Boolean), 'Quoted and minimum-output balances must remain non-negative after estimated gas; allocation is informational');
    stage = 'freshness';
    const block = await client.getBlockNumber({ cacheTime: 0 }), quoteBlock = BigInt(quote.blockNumber);
    const age = Date.now() - Date.parse(quote.quotedAt);
    const priceBlock = pricing.blockNumber ? BigInt(pricing.blockNumber) : undefined;
    add('freshness', age >= 0 && Date.now() < Number(deadline) * 1000 && block >= quoteBlock && block - quoteBlock <= policy.maxQuoteBlocks && pricingFresh(pricing) && (priceBlock === undefined || block >= priceBlock && block - priceBlock <= policy.maxQuoteBlocks), 'Quote, block and valuation price freshness checks');
    add('scope_and_addresses', true, `Chain ${chain.id}; WETH ${weth}; native USDC ${usdc}; router ${router}; recipient ${wallet}`);
    const passed = checks.every(c => c.passed);
    return { status: passed ? 'approved' as const : 'rejected' as const, executionEnabled: passed && policy.executionEnabled, requiresWalletApproval: true, network, checks, balancesBefore: portfolio, quote, pricing, minimumOut: formatUnits(minOut, reverse ? 18 : 6), kind: approvalOnly ? 'usdc_approval' : 'swap', gasEstimate: { gas: gas.toString(), maxFeePerGas: maxFeePerGas.toString(), totalBudgetWei: gasBudget.toString(), totalBudgetEth: formatUnits(gasBudget, 18), totalBudgetUsd: network === 'sepolia' ? null : formatUnits(gasUsd, 8), includesBaseL1DataFee: network === 'base' }, economics: { quotedEthPercent: percentages[0], quotedUsdcPercent: percentages[0] === null ? null : 100 - percentages[0] }, ...(passed ? { transaction: { chainId: chain.id, from: wallet, to, data, value: `0x${value.toString(16)}`, gas: `0x${gas.toString(16)}`, maxFeePerGas: `0x${maxFeePerGas.toString(16)}`, maxPriorityFeePerGas: `0x${priority.toString(16)}`, expiresAt: Number(deadline) * 1000 } } : {}), message: passed && !policy.executionEnabled ? 'Validation passed; real-money execution is locked in backend configuration.' : 'Manual wallet approval required for each transaction.' };
  } catch (error) {
    const failure = validationFailure(error, stage);
    const detail = `${failure.stage}: ${failure.type}${failure.code !== undefined ? `; RPC ${failure.code}` : ''}${failure.httpStatus !== undefined ? `; HTTP ${failure.httpStatus}` : ''}`;
    add('validation', false, `Could not complete ${detail}`);
    console.error('[validation]', JSON.stringify(failure));
    return { ...reject(`Validation failed at ${failure.stage}`), failure };
  }
}

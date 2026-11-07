import { type Address, type Client, type Hex, parseAbi } from 'viem';
import { readContract } from 'viem/actions';
import { base } from 'viem/chains';
import { estimateL1Fee } from 'viem/op-stack';

const oracleAbi = parseAbi(['function getOperatorFee(uint256 gasUsed) view returns (uint256)']);
type FeeTransaction = { account: Address; to: Address; value: bigint; data: Hex };
export class BaseFeeError extends Error {
  component: 'base_l1_fee' | 'base_operator_fee';
  constructor(component: 'base_l1_fee' | 'base_operator_fee', cause: unknown) {
    super(`Could not read ${component}`, { cause });
    this.name = 'BaseFeeError';
    this.component = component;
  }
}

export async function readBaseFeeComponents(client: Client, tx: FeeTransaction, gas: bigint) {
  if (client.chain?.id !== base.id) throw new Error('Base fee estimation requires chain 8453');
  // Reuse the gas estimate that validation already obtained. estimateTotalFee
  // prepares and estimates the transaction again and can invoke eth_fillTransaction,
  // which the public RPC filters. These documented oracle reads need no fill call.
  const [l1Fee, operatorFee] = await Promise.all([
    estimateL1Fee(client, { ...tx, chain: base }).catch(error => { throw new BaseFeeError('base_l1_fee', error); }),
    readContract(client, { address: base.contracts.gasPriceOracle.address, abi: oracleAbi, functionName: 'getOperatorFee', args: [gas] })
      .catch(error => { throw new BaseFeeError('base_operator_fee', error); }),
  ]);
  return { l1Fee, operatorFee };
}

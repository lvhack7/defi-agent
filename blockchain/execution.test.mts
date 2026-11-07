import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, encodeAbiParameters, parseAbi, zeroAddress } from 'viem';
import { validateUsdcSwap } from './reverse-validation.mts';
import { validateSwap } from './validation.mts';
import { isFullInputQuote } from './uniswap.mts';
import { prepareTrade, requestSignature, recordTransaction } from './execution.mts';
const wallet = '0x4259e3c12Bc0ceB7345E38F88809a02Ff83cF502';
test('full-input detection excludes both price limits', () => {
  assert.equal(isFullInputQuote(4295128740n), false);
  assert.equal(isFullInputQuote(1461446703485210103287273052203988822378723970341n), false);
  assert.equal(isFullInputQuote(2n ** 96n), true);
});
test('rejected proposal is persisted idempotently and cannot be signed or tracked as submitted', async () => {
  const key = randomUUID(); let id = '';
  try {
    const trade = await prepareTrade({ wallet, amountEth: '0.01', slippageBps: 101 }, key); id = trade.id;
    assert.equal(trade.status, 'rejected');
    assert.equal((await prepareTrade({}, key)).id, id);
    await assert.rejects(requestSignature(id, wallet));
    await assert.rejects(recordTransaction(id, `0x${'1'.repeat(64)}`));
  } finally { if (id) await unlink(new URL(`./.trades/${id}.json`, import.meta.url)); }
});
test('a fully simulated in-policy swap can pass without broadcasting', async () => {
  const originalFetch = globalThis.fetch, originalRpc = process.env.SEPOLIA_RPC_URL;
  process.env.SEPOLIA_RPC_URL = 'https://rpc.example';
  const abi = parseAbi([
    'function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)',
    'function allowance(address owner,address spender) view returns (uint256)', 'function approve(address spender,uint256 amount) returns (bool)', 'function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)',
    'function token0() view returns (address)', 'function token1() view returns (address)', 'function liquidity() view returns (uint128)',
    'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)',
    'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
    'function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)',
    'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
  ]);
  const number = (n: bigint) => `0x${n.toString(16)}`;
  function sqrt(n: bigint) { let a = n, b = (a+1n)/2n; while(b<a){a=b;b=(a+n/a)/2n}return a }
  const price = sqrt(2n ** 192n * 10n ** 12n / 2000n);
  let transactions = 0, reverse = false;
  let allowance = 0n;
  let txForRpc: {from:string;to:string;data:string;value:string}|undefined;
  let validLogs = false;
  globalThis.fetch = async (_url, init) => {
    const req = JSON.parse(String(init?.body)); let result: unknown;
    if (req.method.startsWith('eth_send')) transactions++;
    if(req.method==='eth_getTransactionByHash'&&txForRpc)result={hash:req.params[0],from:txForRpc.from,to:txForRpc.to,input:txForRpc.data,value:txForRpc.value,chainId:'0xaa36a7',nonce:'0x0',gas:'0x186a0',blockNumber:'0x64',type:'0x2'};
    if(req.method==='eth_getTransactionReceipt'&&txForRpc)result={transactionHash:req.params[0],transactionIndex:'0x0',blockNumber:'0x64',gasUsed:'0x186a0',cumulativeGasUsed:'0x186a0',effectiveGasPrice:'0x3b9aca00',status:'0x1',type:'0x2',logs:validLogs?[{address:'0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',topics:encodeEventTopics({abi:parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']),eventName:'Transfer',args:{from:'0x0000000000000000000000000000000000000001',to:wallet}}),data:encodeAbiParameters([{type:'uint256'}],[1200000000n]),blockNumber:'0x64',transactionIndex:'0x0',logIndex:'0x0'}, {address:'0x0000000000000000000000000000000000000001',topics:encodeEventTopics({abi:parseAbi(['event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)']),eventName:'Swap',args:{sender:'0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',recipient:wallet}}),data:encodeAbiParameters([{type:'int256'},{type:'int256'},{type:'uint160'},{type:'uint128'},{type:'int24'}],[-1200000000n,600000000000000000n,price,100000n,0]),blockNumber:'0x64',transactionIndex:'0x0',logIndex:'0x1'}]:[]};
    if(req.method==='eth_chainId')result='0xaa36a7';
    if(req.method==='eth_blockNumber')result=validLogs?'0x65':'0x64';
    if(req.method==='eth_getBalance')result=number(reverse ? 10n ** 16n : 10n ** 18n);
    if(req.method==='eth_getBlockByNumber')result={number:'0x64',timestamp:number(BigInt(Math.floor(Date.now()/1000))),baseFeePerGas:'0x3b9aca00',gasLimit:'0x1c9c380',gasUsed:'0x0'};
    if(req.method==='eth_maxPriorityFeePerGas')result='0x3b9aca00';
    if(req.method==='eth_gasPrice')result='0x77359400';
    if(req.method==='eth_estimateGas')result='0x186a0';
    if(req.method==='eth_call'){
      const decoded=decodeFunctionData({abi,data:req.params[0].data});
      switch(decoded.functionName){
        case 'getPool':result=encodeFunctionResult({abi,functionName:'getPool',result:decoded.args[2]===500?'0x0000000000000000000000000000000000000001':zeroAddress});break;
        case 'allowance':result=encodeFunctionResult({abi,functionName:'allowance',result:allowance});break;
        case 'approve':result=encodeFunctionResult({abi,functionName:'approve',result:true});break;
        case 'balanceOf':result=encodeFunctionResult({abi,functionName:'balanceOf',result:reverse?1000000000n:0n});break;
        case 'symbol':result=encodeFunctionResult({abi,functionName:'symbol',result:'USDC'});break;
        case 'decimals':result=encodeFunctionResult({abi,functionName:'decimals',result:6});break;
        case 'token0':result=encodeFunctionResult({abi,functionName:'token0',result:'0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'});break;
        case 'token1':result=encodeFunctionResult({abi,functionName:'token1',result:'0xfff9976782d46cc05630d1f6ebab18b2324d6b14'});break;
        case 'liquidity':result=encodeFunctionResult({abi,functionName:'liquidity',result:100000n});break;
        case 'slot0':result=encodeFunctionResult({abi,functionName:'slot0',result:[price,0,0,1,1,0,true]});break;
        case 'quoteExactInputSingle':result=encodeFunctionResult({abi,functionName:'quoteExactInputSingle',result:[reverse?200000000000000000n:1200000000n,price,0,100000n]});break;
        case 'multicall':{
          const swap=decodeFunctionData({abi,data:decoded.args[1][0]});
          assert.equal(swap.functionName,'exactInputSingle');
          if(swap.functionName==='exactInputSingle') { assert.equal(swap.args[0].recipient.toLowerCase(),reverse?'0x3bfa4769fb09eefc5a80d6e87c3b9c650f7ae48e':wallet.toLowerCase()); assert.equal(swap.args[0].amountOutMinimum,reverse?199000000000000000n:1194000000n); }
          result=encodeFunctionResult({abi,functionName:'multicall',result:[encodeFunctionResult({abi,functionName:'exactInputSingle',result:reverse?200000000000000000n:1200000000n}),'0x']});break;
        }
      }
    }
    if(result===undefined)throw new Error('Unexpected RPC '+req.method);
    return new Response(JSON.stringify({jsonrpc:'2.0',id:req.id,result}),{headers:{'content-type':'application/json'}});
  };
  let id = '';
  try {
    const validation = await validateSwap({wallet,amountEth:'0.6',slippageBps:50});
    assert.equal(validation.status,'approved',JSON.stringify(validation.checks));
    assert.ok('transaction' in validation && validation.transaction);
    const trade = await prepareTrade({wallet,amountEth:'0.6',slippageBps:50},randomUUID()); id=trade.id;
    assert.equal(trade.status,'prepared');
    await assert.rejects(requestSignature(id,'0x0000000000000000000000000000000000000002'));
    const transaction=await requestSignature(id,wallet);
    assert.equal(transaction.chainId,11155111);
    await assert.rejects(requestSignature(id,wallet));
    txForRpc=transaction;
    const hash=`0x${'1'.repeat(64)}` as const;
    assert.equal((await recordTransaction(id,hash)).status,'verification_failed');
    validLogs=true;
    assert.equal((await recordTransaction(id,hash)).status,'confirmed');
    reverse=true;
    const missing=await validateUsdcSwap({wallet,amountUsdc:'400',slippageBps:50});
    assert.equal(missing.status,'rejected');
    assert.ok('approvalRequired' in missing && missing.approvalRequired);
    const approval=await validateUsdcSwap({wallet,amountUsdc:'400',slippageBps:50},true);
    assert.equal(approval.status,'approved',JSON.stringify(approval.checks));
    allowance=400000000n;
    const reversed=await validateUsdcSwap({wallet,amountUsdc:'400',slippageBps:50});
    assert.equal(reversed.status,'approved',JSON.stringify(reversed.checks));
    assert.equal(transactions,0);
  } finally { globalThis.fetch=originalFetch; if(originalRpc===undefined)delete process.env.SEPOLIA_RPC_URL;else process.env.SEPOLIA_RPC_URL=originalRpc; if(id)await unlink(new URL(`./.trades/${id}.json`,import.meta.url)); }
});

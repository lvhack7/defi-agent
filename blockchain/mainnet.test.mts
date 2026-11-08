import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseAbi, decodeFunctionData, encodeFunctionResult, encodeEventTopics, encodeAbiParameters, zeroAddress } from 'viem';
import { networkConfig, networkFromChainId, executionEnabled } from './networks.mts';
import { getCoinGeckoPrices } from './prices.mts';
import { analyzePortfolio } from './valuation.mts';
import { calculateSwap } from './swap-calculator.mts';
import { validateTrade } from './trade-validation.mts';
import { prepareTrade, requestSignature, recordTransaction } from './execution.mts';
const wallet = '0x4259e3c12Bc0ceB7345E38F88809a02Ff83cF502';
test('Base deployments are chain-specific and real-money execution defaults closed', () => {
  const base = networkConfig('base'), testnet = networkConfig('sepolia');
  assert.equal(base.chain.id, 8453);
  assert.equal(base.usdc, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  assert.equal(base.weth, '0x4200000000000000000000000000000000000006');
  for(const field of ['factory','quoter','router','usdc','weth'] as const) assert.notEqual(base[field].toLowerCase(),testnet[field].toLowerCase());
  assert.equal(networkFromChainId(8453), 'base');
  const old = process.env.ENABLE_BASE_MAINNET_EXECUTION;
  delete process.env.ENABLE_BASE_MAINNET_EXECUTION;
  try { assert.equal(executionEnabled('base'), false); } finally { if(old !== undefined) process.env.ENABLE_BASE_MAINNET_EXECUTION=old; }
});
test('CoinGecko rejects stale data and uses USDC market price rather than a dollar peg', async () => {
  const original = globalThis.fetch, now=Date.now();
  let stale=false;
  globalThis.fetch=async (_url,init)=>{
    assert.equal((init?.headers as Record<string,string>)['x-cg-demo-api-key'],'test-key');
    return new Response(JSON.stringify({ethereum:{usd:2000,last_updated_at:Math.floor(now/1000)-(stale?400:0)},'usd-coin':{usd:0.8,last_updated_at:Math.floor(now/1000)}}));
  };
  try {
    const prices=await getCoinGeckoPrices('test-key',now);
    assert.equal(prices.usdcPerEth,'2500');
    assert.equal(prices.usdcUsd,'0.80000000');
    stale=true; await assert.rejects(getCoinGeckoPrices('test-key',now), /stale/);
  } finally { globalThis.fetch=original; }
});
test('Base quote/validation uses native addresses, L1 fees, risk limits and a locked wallet handoff', async () => {
  const originalFetch=globalThis.fetch;
  const keys=['BASE_RPC_URL','COINGECKO_API_KEY','ENABLE_BASE_MAINNET_EXECUTION','MAX_TRADE_USD','MAX_GAS_USD'] as const;
  const env=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{BASE_RPC_URL:'https://base-rpc.example',COINGECKO_API_KEY:'fixture',MAX_TRADE_USD:'100',MAX_GAS_USD:'5'});
  delete process.env.ENABLE_BASE_MAINNET_EXECUTION;
  const c=networkConfig('base');
  const abi=parseAbi([
    'function getPool(address tokenA,address tokenB,uint24 fee) view returns (address)', 'function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)', 'function symbol() view returns (string)',
    'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256,uint160,uint32,uint256)',
    'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256)', 'function multicall(uint256 deadline,bytes[] data) payable returns (bytes[])',
    'function getL1Fee(bytes data) view returns (uint256)', 'function getOperatorFee(uint256 gasUsed) view returns (uint256)', 'function allowance(address owner,address spender) view returns (uint256)', 'function approve(address spender,uint256 amount) returns (bool)',
  ]);
  let wrongChain=false, stale=false, quoteOut=6000000n, l1Fee=100000000000n;
  let l1Read=false, operatorRead=false;
  let reverse=false;
  let sent=0, recording=false, wrongTransactionChain=true;
  let released: {from:string;to:string;data:string;value:string} | undefined;
  globalThis.fetch=async (url,init)=>{
    if(String(url).startsWith('https://api.coingecko.com/'))return new Response(JSON.stringify({ethereum:{usd:2000,last_updated_at:Math.floor(Date.now()/1000)-(stale?400:0)},'usd-coin':{usd:1,last_updated_at:Math.floor(Date.now()/1000)}}));
    const req=JSON.parse(String(init?.body)); let result:unknown;
    if(req.method.startsWith('eth_send'))sent++;
    if(req.method==='eth_chainId')result=wrongChain?'0xaa36a7':'0x2105';
    if(req.method==='eth_blockNumber')result=recording?'0x65':'0x64';
    if(req.method==='eth_getBalance')result=recording?'0x71afd498d0000':reverse?'0x38d7ea4c68000':'0x11c37937e08000'; // .001 or .005 ETH
    if(req.method==='eth_getTransactionCount')result='0x0';
    if(req.method==='eth_getBlockByNumber')result={number:'0x64',timestamp:`0x${Math.floor(Date.now()/1000).toString(16)}`,baseFeePerGas:'0x1',gasLimit:'0x1c9c380',gasUsed:'0x0'};
    if(req.method==='eth_maxPriorityFeePerGas'||req.method==='eth_gasPrice')result='0x1';
    if(req.method==='eth_estimateGas')result='0x186a0';
    if(req.method==='eth_getTransactionByHash'&&released)result={hash:req.params[0],from:released.from,to:released.to,input:released.data,value:released.value,chainId:wrongTransactionChain?'0x1':'0x2105',nonce:'0x0',gas:'0x186a0',blockNumber:'0x64',type:'0x2'};
    if(req.method==='eth_getTransactionReceipt')result={transactionHash:req.params[0],transactionIndex:'0x0',blockNumber:'0x64',gasUsed:'0x186a0',cumulativeGasUsed:'0x186a0',effectiveGasPrice:'0x1',status:'0x1',type:'0x2',logs:[{address:c.usdc,topics:encodeEventTopics({abi:parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']),eventName:'Transfer',args:{from:'0x0000000000000000000000000000000000000001',to:wallet}}),data:encodeAbiParameters([{type:'uint256'}],[6000000n]),blockNumber:'0x64',transactionIndex:'0x0',logIndex:'0x0'},{address:'0x0000000000000000000000000000000000000001',topics:encodeEventTopics({abi:parseAbi(['event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)']),eventName:'Swap',args:{sender:c.router,recipient:wallet}}),data:encodeAbiParameters([{type:'int256'},{type:'int256'},{type:'uint160'},{type:'uint128'},{type:'int24'}],[3000000000000000n,-6000000n,2n**96n,100000n,0]),blockNumber:'0x64',transactionIndex:'0x0',logIndex:'0x1'}]};
    if(req.method==='eth_call'){
      const decoded=decodeFunctionData({abi,data:req.params[0].data});
      const target=req.params[0].to.toLowerCase();
      switch(decoded.functionName){
        case 'getPool':
          assert.equal(target,c.factory.toLowerCase());
          assert.deepEqual(new Set(decoded.args.slice(0,2).map((s:unknown)=>String(s).toLowerCase())),new Set([c.weth.toLowerCase(),c.usdc.toLowerCase()]));
          result=encodeFunctionResult({abi,functionName:'getPool',result:decoded.args[2]===500?'0x0000000000000000000000000000000000000001':zeroAddress});break;
        case 'balanceOf':assert.equal(target,c.usdc.toLowerCase());result=encodeFunctionResult({abi,functionName:'balanceOf',result:recording?6000000n:reverse?3000000n:0n});break;
        case 'decimals':result=encodeFunctionResult({abi,functionName:'decimals',result:6});break;
        case 'symbol':result=encodeFunctionResult({abi,functionName:'symbol',result:'USDC'});break;
        case 'quoteExactInputSingle':assert.equal(target,c.quoter.toLowerCase());result=encodeFunctionResult({abi,functionName:'quoteExactInputSingle',result:[reverse?quoteOut:quoteOut,2n**96n,0,100000n]});break;
        case 'multicall':{
          assert.equal(target,c.router.toLowerCase());
          const decodedSwap=decodeFunctionData({abi,data:decoded.args[1][0]});
          assert.equal(decodedSwap.functionName,'exactInputSingle');
          if(decodedSwap.functionName==='exactInputSingle'){ assert.equal(decodedSwap.args[0].tokenIn.toLowerCase(),reverse?c.usdc.toLowerCase():c.weth.toLowerCase());assert.equal(decodedSwap.args[0].tokenOut.toLowerCase(),reverse?c.weth.toLowerCase():c.usdc.toLowerCase()); }
          result=encodeFunctionResult({abi,functionName:'multicall',result:[encodeFunctionResult({abi,functionName:'exactInputSingle',result:quoteOut}),'0x']});break;
        }
        case 'getL1Fee':l1Read=true;result=encodeFunctionResult({abi,functionName:'getL1Fee',result:l1Fee});break;
        case 'getOperatorFee':operatorRead=true;result=encodeFunctionResult({abi,functionName:'getOperatorFee',result:10n});break;
        case 'allowance':result=encodeFunctionResult({abi,functionName:'allowance',result:10000000n});break;
        case 'approve':assert.equal(target,c.usdc.toLowerCase());assert.equal(decoded.args[0].toLowerCase(),c.router.toLowerCase());result=encodeFunctionResult({abi,functionName:'approve',result:true});break;
      }
    }
    if(result===undefined)throw new Error(`Unexpected RPC ${req.method}`);
    return new Response(JSON.stringify({jsonrpc:'2.0',id:req.id,result}),{headers:{'content-type':'application/json'}});
  };
  let id='';
  try {
    const valuation=await analyzePortfolio({wallet,network:'base'});
    assert.equal(valuation.valuation?.currency,'USD');assert.equal(valuation.valuation?.total,'10');
    const calculation=await calculateSwap({network:'base',tokenIn:'ETH',amount:'0.003',slippageBps:50});
    assert.equal(calculation.status,'quoted');
    assert.ok('minimumOut' in calculation && calculation.minimumOut==='5.97');
    assert.ok('rate' in calculation && calculation.rate.amountOut==='2000');
    assert.ok(!('transaction' in calculation));
    const input={wallet,network:'base',amountEth:'0.003',slippageBps:50};
    const validation=await validateTrade(input);
    assert.equal(validation.status,'approved',JSON.stringify(validation.checks));
    assert.equal(validation.executionEnabled,false);
    assert.ok('transaction' in validation&&validation.transaction?.chainId===8453);
    assert.ok(l1Read&&operatorRead,'Base L1 data and operator fees must be read');
    // User-selected swaps are valid without any enforced allocation ratio.
    quoteOut=2000000n;
    const userSelected=await validateTrade({...input,amountEth:'0.001'});
    assert.equal(userSelected.status,'approved',JSON.stringify(userSelected.checks));
    assert.ok('economics' in userSelected && Number(userSelected.economics.quotedEthPercent)>75);
    assert.ok(!userSelected.checks.some(c=>c.name==='post_swap_allocation'));
    assert.ok(userSelected.checks.some(c=>c.name==='post_swap_balances'&&c.passed));
    quoteOut=6000000n;
    const trade=await prepareTrade(input,randomUUID());id=trade.id;
    await assert.rejects(requestSignature(id,wallet),/disabled/);
    process.env.ENABLE_BASE_MAINNET_EXECUTION='true';
    released=await requestSignature(id,wallet);
    assert.equal(released.to.toLowerCase(),c.router.toLowerCase());
    assert.equal('chainId' in released && released.chainId,8453);
    delete process.env.ENABLE_BASE_MAINNET_EXECUTION;
    wrongChain=true;assert.equal((await validateTrade(input)).status,'rejected');wrongChain=false;
    stale=true;assert.equal((await validateTrade(input)).status,'rejected');stale=false;
    process.env.MAX_TRADE_USD='1';
    const limited=await validateTrade(input);assert.ok(limited.checks.some(c=>c.name==='trade_limit'&&!c.passed));process.env.MAX_TRADE_USD='100';
    l1Fee=10n**16n;
    const costly=await validateTrade(input);assert.ok(costly.checks.some(c=>c.name==='gas_limit'&&!c.passed));l1Fee=100000000000n;
    quoteOut=60000000n;
    const deviated=await validateTrade(input);assert.ok(deviated.checks.some(c=>c.name==='price_deviation'&&!c.passed));
    reverse=true;quoteOut=100000000000000n;
    const reversed=await validateTrade({wallet,network:'base',amountUsdc:'0.2',slippageBps:50});
    assert.equal(reversed.status,'approved',JSON.stringify(reversed.checks));
    assert.equal(reversed.executionEnabled,false);
    const allowance=await validateTrade({wallet,network:'base',amountUsdc:'0.2',slippageBps:50},true);
    assert.equal(allowance.status,'approved',JSON.stringify(allowance.checks));assert.equal(allowance.executionEnabled,false);
    reverse=false; recording=true;
    const hash=`0x${'2'.repeat(64)}` as const;
    await assert.rejects(recordTransaction(id,hash),/does not match/);
    wrongTransactionChain=false;
    const verified=await recordTransaction(id,hash);
    assert.equal(verified.status,'confirmed',JSON.stringify(verified.result));
    assert.ok((verified.result as {inputVerified:boolean}).inputVerified);
    assert.equal((verified.result as {portfolio:{chainId:number}}).portfolio.chainId,8453);
    assert.equal((verified.result as {portfolio:{tokens:{balance:string}[]}}).portfolio.tokens[0].balance,'6');
    assert.equal(sent,0);
  } finally { globalThis.fetch=originalFetch; for(const key of keys){if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];} if(id)await unlink(new URL(`./.trades/${id}.json`,import.meta.url)); }
});

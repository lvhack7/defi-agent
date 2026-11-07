import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { supportsSepoliaSigning, describeWalletPermissions, requestSepoliaAccess, supportsSigning, requestNetworkAccess, pairForNetwork } from '../src/wallet-session.ts'
const address = '0x4259e3c12Bc0ceB7345E38F88809a02Ff83cF502'
test('mainnet-only pairing never authorizes Sepolia signing', () => {
  assert.equal(supportsSepoliaSigning({namespaces:{eip155:{accounts:[`eip155:1:${address}`],methods:['eth_sendTransaction'],chains:['eip155:1']}}}), false)
  assert.equal(supportsSepoliaSigning(undefined), false)
  const description = describeWalletPermissions({namespaces:{eip155:{accounts:[`eip155:1:${address}`],methods:['eth_sendTransaction']}}})
  assert.match(description, /Ethereum mainnet \(1\)/)
  assert.match(description, /eth_sendTransaction/)
  assert.ok(!description.includes(address))
})
test('requires both a Sepolia account and transaction permission', () => {
  assert.equal(supportsSepoliaSigning({namespaces:{eip155:{accounts:[`eip155:11155111:${address}`],methods:['eth_sendTransaction']}}}), true)
  assert.equal(supportsSepoliaSigning({namespaces:{eip155:{accounts:[`eip155:11155111:${address}`],methods:['personal_sign']}}}), false)
  assert.equal(supportsSepoliaSigning({namespaces:{'eip155:1':{accounts:[`eip155:11155111:${address}`],methods:['eth_sendTransaction']}}}), false)
})

test('network request enables signing only after actual session authorization', async () => {
  const session = {namespaces:{eip155:{accounts:[`eip155:1:${address}`],methods:['eth_sendTransaction','wallet_switchEthereumChain']}}}
  const calls: string[] = []
  const account = await requestSepoliaAccess({session, request: async args => {
    calls.push(args.method)
    if(args.method === 'wallet_switchEthereumChain') {
      assert.deepEqual(args.params, [{chainId:'0xaa36a7'}])
      session.namespaces.eip155.accounts.push(`eip155:11155111:${address}`)
      return null
    }
    if(args.method === 'eth_chainId') return '0xaa36a7'
    if(args.method === 'eth_accounts') return [address]
    throw new Error('Unexpected method')
  }})
  assert.equal(account,address)
  assert.ok(!calls.includes('eth_sendTransaction'))
})
test('declined switch keeps mainnet-only session unauthorized', async () => {
  const session = {namespaces:{eip155:{accounts:[`eip155:1:${address}`],methods:['eth_sendTransaction','wallet_switchEthereumChain']}}}
  await assert.rejects(requestSepoliaAccess({session,request: async () => {throw {code:4001}}}), /declined/)
  assert.equal(supportsSepoliaSigning(session),false)
})
test('a provider-local chain change does not grant missing session permissions', async () => {
  const session = {namespaces:{eip155:{accounts:[`eip155:1:${address}`],methods:['eth_sendTransaction','wallet_switchEthereumChain']}}}
  await assert.rejects(requestSepoliaAccess({session,request: async args => {
    assert.equal(args.method,'wallet_switchEthereumChain')
    return null
  }}), /did not grant/)
  assert.equal(supportsSepoliaSigning(session),false)
})

test('Base permission cannot be inferred from mainnet or Sepolia access', () => {
  const session={namespaces:{eip155:{accounts:[`eip155:1:${address}`,`eip155:11155111:${address}`],methods:['eth_sendTransaction']}}}
  assert.equal(supportsSigning(session,8453),false)
  session.namespaces.eip155.accounts.push(`eip155:8453:${address}`)
  assert.equal(supportsSigning(session,8453),true)
  assert.equal(supportsSigning(session,84532),false)
})
test('Base access requests chain 8453 and verifies the wallet-approved account', async () => {
  const session={namespaces:{eip155:{accounts:[`eip155:1:${address}`],methods:['eth_sendTransaction','wallet_switchEthereumChain']}}}
  const result=await requestNetworkAccess({session,request:async args=>{
    if(args.method==='wallet_switchEthereumChain') {assert.deepEqual(args.params,[{chainId:'0x2105'}]);session.namespaces.eip155.accounts.push(`eip155:8453:${address}`);return null}
    if(args.method==='eth_chainId')return '0x2105'
    if(args.method==='eth_accounts')return [address]
    throw new Error('No transaction method is expected')
  }},8453)
  assert.equal(result,address)
})

test('Base pairing replaces an existing mainnet-only session and requires Base explicitly', async () => {
  let session: {namespaces:Record<string,{accounts:string[];methods:string[]}>}|undefined = {namespaces:{eip155:{accounts:[`eip155:1:${address}`],methods:['eth_sendTransaction']}}}
  const calls:string[]=[]
  await pairForNetwork({
    get session(){return session},
    disconnect:async()=>{calls.push('disconnect');session=undefined},
    connect:async options=>{assert.deepEqual(options,{chains:[8453]});calls.push('connect');session={namespaces:{eip155:{accounts:[`eip155:8453:${address}`],methods:['eth_sendTransaction']}}}},
  },8453)
  assert.deepEqual(calls,['disconnect','connect'])
  assert.equal(supportsSigning(session,8453),true)
})
test('Base pairing rejects a wallet that returns mainnet-only permissions', async () => {
  let session: {namespaces:Record<string,{accounts:string[];methods:string[]}>}|undefined
  await assert.rejects(pairForNetwork({
    get session(){return session},disconnect:async()=>{session=undefined},
    connect:async()=>{session={namespaces:{eip155:{accounts:[`eip155:1:${address}`],methods:['eth_sendTransaction']}}}},
  },8453),/cannot fall back/)
})
test('a valid Base session is reused without another permission request', async () => {
  const session={namespaces:{eip155:{accounts:[`eip155:8453:${address}`],methods:['eth_sendTransaction']}}}
  await pairForNetwork({session,disconnect:async()=>{throw new Error('Unexpected disconnect')},connect:async()=>{throw new Error('Unexpected pairing')}},8453)
})

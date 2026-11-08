# DeFi Autopilot

ZooWork treasury agent, viem/Uniswap v3 tools, and a React dashboard with manual Trust Wallet / WalletConnect approval.

## Networks and pricing

- **Base Mainnet (`base`, 8453):** native ETH and Circle USDC. CoinGecko ETH/USD and USDC/USD for valuation and risk checks; real Uniswap v3 direct-pool quotes for swaps. Base L1 data, L2 execution and operator fee estimates are included in a conservative gas budget.
- **Ethereum Mainnet (`mainnet`, 1):** separate Ethereum contracts/RPC, CoinGecko valuation and Uniswap quotes.
- **Ethereum Sepolia (`sepolia`, 11155111):** retained for testing, with test USDC pool pricing. No real financial value.

Select a network in the dashboard before refreshing the portfolio or preparing a proposal. Wallet permissions, RPC chain ID, contract addresses, proposals, transaction requests and receipt tracking are bound to that chain. Existing proposals without a network are treated as legacy Sepolia proposals. Base Mainnet is not Base Sepolia.

## Run locally

Use Node.js 22.6+. Keep backend credentials in root `.env.local`; use `.env.example` as the list of settings. Install dependencies with `npm install` in `agent/`, `blockchain/`, and `client/`. From `client/` run `npm run build`. From `agent/` run `npm run server`, then open **http://localhost:3100**. Stop the CLI first; the backend and CLI share a process lock. Use Ctrl+C for clean shutdown. After a crash, startup automatically recovers a runtime lock only when its recorded process is confirmed dead. Live, inaccessible or malformed owner records are preserved. Normal exits and startup exceptions clean up their own locks. A rare interrupted recovery can leave `.runtime.lock.recovery`; confirm all agent processes are stopped before removing that file.

The landing page is at `/`; **Open dashboard** goes to `/dashboard`. The dashboard keeps portfolio, agent chat, and swaps in one workspace. Landing-page examples are labeled as product previews and do not show live balances. Agent prompt shortcuts fill the message box; sending is a separate action.

Required for Base read-only analysis and validation:

```dotenv
ZOOWORK_API_KEY=your_project_key
VITE_WALLETCONNECT_PROJECT_ID=your_reown_project_id
BASE_RPC_URL=https://mainnet.base.org
COINGECKO_API_KEY=your_demo_api_key
ENABLE_BASE_MAINNET_EXECUTION=false
ENABLE_ETHEREUM_MAINNET_EXECUTION=false
MAX_TRADE_USD=100
MAX_GAS_USD=5
```

The public Base RPC is rate-limited; a provider endpoint can be substituted. Set `ETHEREUM_RPC_URL` to use Ethereum Mainnet and `SEPOLIA_RPC_URL` to retain testnet functionality. CoinGecko uses its Demo API header; stale (>5 minutes), invalid or missing prices cause validation to reject. USDC is valued at its fetched market price, not an assumed dollar peg. No key or RPC credential is sent to the browser. Only `VITE_` variables enter the client build.

## Execution is locked by default

Both real-money execution flags default to false. Portfolio reads, quotes, proposals and validations remain available. The backend refuses to release a mainnet transaction while its flag is false, even if a proposal passed validation. There is no agent tool or HTTP endpoint to enable execution.

Only after testing and reviewing the resulting proposal, an operator can explicitly set `ENABLE_BASE_MAINNET_EXECUTION=true` locally and restart the backend. Ethereum Mainnet has its own separate flag. Reload the dashboard and prepare a fresh proposal. Every swap **and USDC approval transaction** still requires manual wallet confirmation. Connecting the wallet or enabling the flag never sends a transaction by itself.

Users choose swap amounts and any rebalance targets in chat. There is no mandatory allocation ratio; expected allocations are informational. Validation controls: maximum 5% quote deviation from valuation prices; slippage ≤100 bps; quote age ≤30 seconds and 15 Base blocks (3 Ethereum/Sepolia blocks); configurable notional and gas USD limits. Reserve after spending and estimated gas: 0.0001 ETH on Base, 0.005 ETH on Ethereum/Sepolia. All-in Base fee estimation must succeed. Gas budgets include a 20% margin and conservatively add Base's all-in estimate to the max-fee execution budget. Actual fees and market state can change.

## Wallet approval and verification

Use **Connect wallet** to scan the QR code with Trust Wallet, or **Use extension**, and approve the session for the selected network. The session must explicitly grant the chain's account and `eth_sendTransaction`. “Request network access” requests a switch and checks the actual updated session; a local provider chain change alone never enables trading. A wallet that omits the selected chain cannot sign for it.

The agent automatically uses the connected wallet and selected network. Ask **“How much ETH do I have, and what is it worth?”** without typing an address. A manually entered address is used for read-only viewing when no wallet is connected. Each chat turn supplies fresh context; account/network changes replace the previous context, and disconnecting clears the active address. The context does not grant transaction permission.

ETH → USDC uses native ETH and refunds unused ETH. USDC → ETH requires an exact-amount allowance to that chain's router; first approve that allowance, wait for its receipt, then validate a fresh swap. WETH is unwrapped to ETH for the wallet. Allowances are never unlimited.

For USDC → ETH, the calculator checks the selected wallet's on-chain router allowance. If it covers the input, **Review swap** reuses it. Otherwise **Review USDC approval** prepares an exact-amount approval. After confirmation, the approval card's **Review USDC → ETH swap** button creates a separately validated swap for the same amount; repeated clicks return the same proposal. Approval does not exchange tokens. Both transactions require separate wallet confirmations. The continuation refuses unconfirmed approvals, ordinary swaps, and a different wallet. An allowance smaller than the full USDC balance covers only the approved amount.

Router simulation uses the quote's block so an exact output comparison uses the same pool state. Gas estimation still checks current state. Freshness, minimum output, and validation before wallet release remain enforced.

Before release to the wallet, the backend obtains a fresh quote on the reviewed pool and simulates again, preserving the exact reviewed minimum output and chain/sender/target/value. Small price changes above that floor can pass. Quotes still must satisfy the 30-second freshness check; proposals have a five-minute review window and transactions receive a fresh five-minute router deadline at release. A proposal can be released only once. Expired proposals or quotes below the reviewed floor require a replacement: **Refresh quote** supersedes the unreleased proposal, and the user must review and select **Review & sign** again. Refresh never releases a transaction. If a wallet response is uncertain, inspect Trust Wallet and recover with its original hash instead of submitting a duplicate. Trading uses direct v3 pools at four fee tiers, not an exhaustive multi-hop route search.

Receipt verification checks sender, chain, target, calldata and ETH value, verifies the selected pool's actual input via Swap logs, checks received USDC or WETH withdrawal evidence, and reads native/token balances at the receipt block. Two observed confirmations and successful balance reads are required for `confirmed`; incomplete verification remains pending or failed. This is not a guarantee of irreversible chain finality. Records persist in `blockchain/.trades/`; keep them and the ZooWork session state for recovery.

## Swap calculations

The Swaps panel accepts an ETH or USDC amount and shows actual Uniswap output, the effective rate, the slippage minimum, and the included pool fee. CoinGecko prices provide USD reference values; they do not determine swap output. Calculations need no wallet and create no trade records. Input changes trigger a debounced quote request. Quotes expire after 30 seconds and require manual refresh; outdated responses cannot replace a calculation for another amount, direction, slippage, or chain.

Review swap runs full wallet-based validation and obtains network fees. Gas is separate from quoted output. In chat, ask “How much USDC would I get for 0.001 ETH?” or “Calculate 5 USDC to ETH at 50 bps slippage.” A hypothetical calculation does not prepare a transaction.

## Agent tools and checks

The agent exposes `get_portfolio`, `analyze_portfolio`, `calculate_swap`, `quote_swap`, `propose_rebalance`, `validate_swap`, `prepare_trade`, and `get_trade_status`. Dashboard tool calls inherit the active wallet and selected network; mismatched inputs are rejected. Wallet-specific CLI calls require wallet/network inputs; quote calculations require a network but no wallet. Old `*_sepolia_*` tool names remain bound to Sepolia and are rejected under a different dashboard network. SDK 0.14.0 is retained; the agent uses documented lifecycle, cursor streaming, custom-tool declaration and resolution methods. Dashboard context and question are sent in one `user.message`: live checks found the deployment's `system.message` write returns HTTP 502. Delivery keys persist for safe retries.

Run `node --experimental-strip-types --test agent/tests/*.test.mts client/tests/*.test.mts blockchain/*.test.mts` from the root. The TypeScript check and dashboard build cover the integration. Context tests cover wallet defaults, account/network changes, disconnects, stale inputs and CLI behavior. Base tests mock RPC and prices, including both directions, approvals, fee oracle calls, wrong-chain rejection, price/gas limits, default execution lock, receipt logs and resulting balances. No real-money transaction has been submitted by this coding agent. Live RPC/market verification and a fork integration test must be distinguished from these offline tests.

Verified deployment sources: [Uniswap Base](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments), [Uniswap Ethereum](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments), [Circle USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses), [Base network details](https://docs.base.org/get-started/connect-to-base), [CoinGecko Demo](https://docs.coingecko.com/demo/reference/simple-price).

Mobile QR pairing now requires the selected network explicitly (for example, Base 8453), with `eth_sendTransaction`. A restored session that only approves another network is disconnected before requesting a fresh pairing. “Pair again for Base Mainnet” lets the user explicitly replace an old mainnet-only session. A wallet returning different-chain permissions is rejected; valid sessions for the selected chain are reused. Changing networks never authorizes a transaction.

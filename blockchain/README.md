# Blockchain package

Owns chain configuration, ETH/native USDC balance reads, market prices, Uniswap quotes, valuation, rebalance proposals, validation, persistent proposals and on-chain receipt verification. See the root README for setup, current policy, execution flags and limits.

`networks.mts` contains separate verified Base Mainnet, Ethereum Mainnet and Ethereum Sepolia deployments. `prices.mts` uses CoinGecko on real networks and on-chain pool spot prices only on Sepolia. `trade-validation.mts` applies slippage, price, amount, gas and balance checks to both directions and simulates the exact router or USDC approval call. Allocation percentages are informational; users choose swap amounts and any optional rebalance target. `execution.mts` exposes validated transactions only for explicit wallet approval, never signing or broadcasting on the backend. `base-fees.mts` reads L1 data fees using viem's `estimateL1Fee` and operator fees from Base's GasPriceOracle, reusing the gas estimate already obtained during validation. It does not invoke `eth_fillTransaction` or re-estimate the router call. Missing fee components reject with a named failure stage.

Mainnet execution is **disabled by default**, independently per chain. Price/RPC/simulation failures reject; execution flags cannot be changed by agent inputs. Receipt verification and balances are read on the saved proposal's chain, not whichever network the UI currently selects. Local private records are ignored by Git.

Run `npm test` with Node 22.6+. Fixtures do not establish live liquidity or mainnet readiness.

# DeFi Autopilot dashboard

See the root README. Run `npm install`, then `npm run build`; `agent/` serves `dist/` on http://localhost:3100. Root `.env.local` is used for the public WalletConnect project ID; backend API keys are never exposed as VITE variables.

Network selector: Base Mainnet, Ethereum Mainnet, or Ethereum Sepolia. Proposals and history are filtered to the selected chain. Mainnet execution is locked by default on the backend; the UI cannot enable it. Every transaction requires manual Trust Wallet approval. Wallet sessions must authorize the specific chain, signing method and account.

Run permission tests with `node --experimental-strip-types --test tests/wallet-session.test.mts` on Node 22.6+. Browser wallet flows still need real-device verification.

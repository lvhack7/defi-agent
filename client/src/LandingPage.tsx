import { Brand } from './Brand'
import { CryptoIcon } from './CryptoIcon'
import { Icon } from './Icon'
import { TokenIcon } from './TokenIcon'
import './LandingPage.css'

export function LandingPage() {
  return <div className="landing">
    <a className="skip-link" href="#landing-content">Skip to content</a>
    <header className="landing-nav landing-container">
      <Brand/>
      <nav aria-label="Main navigation"><a href="#features">Features</a><a href="#how-it-works">How it works</a></nav>
      <a className="landing-button nav-cta" href="/dashboard">Open dashboard <Icon name="arrow"/></a>
    </header>
    <main id="landing-content" className="landing-main">
      <section className="landing-hero landing-container">
        <div className="hero-copy">
          <span className="landing-eyebrow"><span className="eyebrow-spark"><Icon name="agent"/></span> Your on-chain copilot</span>
          <h1>Your crypto.<br/>A clearer<br/><span>next move.</span></h1>
          <p>Meet your DeFi workspace. Track ETH and USDC, ask your agent, and turn live Uniswap quotes into swaps you approve.</p>
          <div className="hero-actions"><a className="landing-button" href="/dashboard">Launch dashboard <Icon name="arrow"/></a><a className="landing-text-link" href="#how-it-works">See how it works <span>↘</span></a></div>
          <div className="hero-assurance"><Icon name="lock"/> Your wallet. Your approval. Every transaction.</div>
        </div>
        <div className="hero-visual" aria-label="Illustrative product preview, not a live portfolio">
          <div className="visual-orbit orbit-one"/><div className="visual-orbit orbit-two"/>
          <span className="floating-token float-eth"><TokenIcon token="ETH"/></span>
          <span className="floating-token float-usdc"><TokenIcon token="USDC"/></span>
          <div className="product-preview">
            <div className="preview-top"><span><Icon name="overview"/> Your workspace</span><span className="preview-label">Product preview</span></div>
            <div className="preview-portfolio"><span>One place for your assets</span><h2>Stay in the know.</h2><div className="preview-assets"><span><TokenIcon token="ETH"/> Ethereum</span><span><TokenIcon token="USDC"/> USD Coin</span></div></div>
            <div className="preview-agent"><span className="mini-agent"><Icon name="agent"/></span><div><strong>Ask. Understand. Act.</strong><p>“What would I receive for 0.01 ETH?”</p></div></div>
            <div className="preview-swap"><div><span>You pay</span><strong>0.01 <small>ETH</small></strong></div><span className="preview-swap-arrow"><Icon name="arrow"/></span><div><span>You receive</span><strong>Live quote <small>USDC</small></strong></div></div>
            <div className="preview-bottom"><span><Icon name="lock"/> Review before you sign</span><span className="preview-review">Your call <Icon name="arrow"/></span></div>
          </div>
          <div className="network-float"><CryptoIcon name="base"/><div><strong>Built for on-chain</strong><span>Base & Ethereum</span></div><span className="network-float-check"><Icon name="check"/></span></div>
        </div>
      </section>
      <section className="landing-stack landing-container" aria-label="Supported networks and integrations"><p>Connected to the DeFi you use</p><div><span><CryptoIcon name="ethereum"/>Ethereum</span><span><CryptoIcon name="base"/>Base</span><span><CryptoIcon name="uniswap"/>Uniswap</span><span><CryptoIcon name="walletconnect"/>WalletConnect</span></div></section>
      <section id="features" className="landing-features landing-container">
        <div className="landing-section-heading"><div><span className="section-kicker">LESS FRICTION. MORE CLARITY.</span><h2>From wallet to next move.</h2></div><p>The context you need, the tools to act,<br className="desktop-break"/> and the final say in your wallet.</p></div>
        <div className="feature-grid">
          <article><span className="feature-icon"><Icon name="wallet"/></span><span className="feature-index">01 / TRACK</span><h3>A portfolio that makes sense.</h3><p>See your ETH and USDC balances, market value, and allocation on your selected network.</p><div className="feature-assets"><TokenIcon token="ETH"/><TokenIcon token="USDC"/><span>Two assets. One clear view.</span></div></article>
          <article><span className="feature-icon"><Icon name="agent"/></span><span className="feature-index">02 / ASK</span><h3>Talk through your next step.</h3><p>Ask about your connected wallet or calculate a swap in plain language. Your agent brings the tools.</p><div className="feature-prompt"><Icon name="agent"/><span>“How much is my ETH worth?”</span></div></article>
          <article><span className="feature-icon"><Icon name="swap"/></span><span className="feature-index">03 / SWAP</span><h3>Live quotes. Clear terms.</h3><p>Check expected output, minimum received, and estimated fees before approving in your wallet.</p><div className="feature-route"><TokenIcon token="ETH"/><span className="route-line"/><CryptoIcon name="uniswap"/><span className="route-line"/><TokenIcon token="USDC"/></div></article>
        </div>
      </section>
      <section id="how-it-works" className="landing-how landing-container">
        <div className="how-intro"><span className="section-kicker">YOU STAY IN CONTROL</span><h2>An agent on your side.<br/>The keys stay with you.</h2><p>DeFi Autopilot prepares the next step. Your wallet gives the final approval.</p><a href="/dashboard" className="landing-text-link">Explore the workspace <Icon name="arrow"/></a></div>
        <ol className="how-steps">
          <li><span>01</span><div><h3>Connect your wallet</h3><p>Pair your mobile wallet by QR or use your browser extension. Choose Base, Ethereum, or Sepolia to test.</p></div></li>
          <li><span>02</span><div><h3>Tell your agent what you need</h3><p>Check your balances or choose how much ETH or USDC you want to swap.</p></div></li>
          <li><span>03</span><div><h3>Review. Approve. Verify.</h3><p>Review the validated proposal, sign in your wallet, and track the transaction on-chain.</p></div></li>
        </ol>
      </section>
      <section className="landing-cta landing-container"><div><span className="section-kicker">YOUR NEXT MOVE STARTS HERE</span><h2>Make room for a clearer view.</h2><p>Your portfolio, your agent, your decisions.</p></div><a href="/dashboard" className="landing-button">Open dashboard <Icon name="arrow"/></a></section>
    </main>
    <footer className="landing-footer landing-container"><Brand/><span>ETH & USDC. Built with ZooWork.</span><a href="/dashboard">Go to dashboard <Icon name="arrow"/></a></footer>
  </div>
}

export function TokenIcon({ token }: { token: 'ETH' | 'USDC' }) {
  return token === 'ETH' ? (
    <svg className="token-icon" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill="#edf1fb"/>
      <path d="m20 6 8 14-8 4.7-8-4.7Z" fill="#8c9bc5"/>
      <path d="m20 6 8 14-8 4.7Z" fill="#53648f"/>
      <path d="m12 20 8-3.6 8 3.6-8 4.7Z" fill="#667aa8"/>
      <path d="m20 16.4 8 3.6-8 4.7Z" fill="#34476e"/>
      <path d="m12 22 8 12 8-12-8 4.7Z" fill="#8c9bc5"/>
      <path d="m20 26.7 8-4.7-8 12Z" fill="#53648f"/>
    </svg>
  ) : (
    <svg className="token-icon" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill="#2775ca"/>
      <path d="M14 8.8a12.7 12.7 0 0 0 0 22.4M26 8.8a12.7 12.7 0 0 1 0 22.4" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M24 15.4c-.7-1.1-2-1.7-4-1.7-2.1 0-3.7 1.1-3.7 2.9 0 4.2 7.6 2 7.6 6.2 0 1.9-1.7 3.1-3.9 3.1-1.8 0-3.4-.6-4.2-1.9M20 11v2.7M20 26v3" fill="none" stroke="white" strokeWidth="1.9" strokeLinecap="round"/>
    </svg>
  )
}

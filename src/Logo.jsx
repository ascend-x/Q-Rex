/** Q-Rex mark: a navy tile with a saffron tracking reticle locked onto a (slightly off-centre) beacon. */
export default function Logo({ size = 40, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Q-Rex logo">
      <rect x="5" y="5" width="40" height="40" rx="7" fill="#111" />
      <rect x="2" y="2" width="40" height="40" rx="7" fill="#0d1b2a" stroke="#111" strokeWidth="2.5" />
      <circle cx="22" cy="22" r="12.5" fill="none" stroke="#ff6b00" strokeWidth="3" />
      <path d="M22 5v8M22 31v8M5 22h8M31 22h8" stroke="#ff6b00" strokeWidth="2.6" strokeLinecap="round" />
      <rect x="21" y="16.5" width="8" height="8" rx="1" fill="#fff" transform="rotate(-12 25 20.5)" />
      <rect x="18.8" y="14.3" width="12.4" height="12.4" rx="1.5" fill="none" stroke="#22ff88" strokeWidth="1.6" transform="rotate(-12 25 20.5)" />
    </svg>
  )
}

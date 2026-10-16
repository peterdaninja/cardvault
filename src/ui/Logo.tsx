/**
 * SLOWTCG wordmark: bold yellow lettering with a thick blue outline and a deeper blue drop edge,
 * in the spirit of a classic trading-card-game logo (original lettering, not a copy of one).
 */
export default function Logo({ height = 40 }: { height?: number }) {
  const font = "'Arial Black', 'Avenir Next Heavy', 'Helvetica Neue', Impact, system-ui, sans-serif"
  const common = {
    x: 150,
    y: 50,
    textAnchor: 'middle' as const,
    fontFamily: font,
    fontWeight: 900,
    fontSize: 54,
    letterSpacing: 1,
    strokeLinejoin: 'round' as const,
  }
  return (
    <svg viewBox="0 0 300 74" height={height} role="img" aria-label="SLOWTCG" style={{ display: 'block', overflow: 'visible' }}>
      <text {...common} y={56} fill="#14245f" stroke="#14245f" strokeWidth={17}>SLOWTCG</text>
      <text {...common} fill="#2f55c8" stroke="#2f55c8" strokeWidth={13}>SLOWTCG</text>
      <text {...common} fill="#ffcb05" stroke="#3d68e0" strokeWidth={4} paintOrder="stroke">SLOWTCG</text>
      <text {...common} fill="none" stroke="#fff3a8" strokeWidth={1.2} opacity={0.65} transform="translate(0 -1)">SLOWTCG</text>
    </svg>
  )
}

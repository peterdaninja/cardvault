export const money = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Compact for big stat tiles: $1.2K, $34.5K. */
export const moneyShort = (n: number) =>
  n >= 10_000 ? `$${(n / 1000).toFixed(1)}K` : money(n)

export const signedMoney = (n: number) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`

export const dateLabel = (t: number, withTime = false) =>
  new Date(t).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  })

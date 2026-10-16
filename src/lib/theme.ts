export type ThemeKey = 'auto' | 'midnight' | 'light' | 'electric' | 'holo' | 'forest'

export interface ThemeInfo {
  key: ThemeKey
  label: string
  blurb: string
  swatch: string[] // background, surface, accent, accent 2
  bar: string // browser / status bar color
}

export const THEMES: ThemeInfo[] = [
  { key: 'auto', label: 'Auto', blurb: 'Matches your phone', swatch: ['#0a0c11', '#161a23', '#f2f3f7', '#ff4d2e'], bar: '' },
  { key: 'midnight', label: 'Midnight', blurb: 'Dark with orange', swatch: ['#0a0c11', '#14181f', '#ff4d2e', '#ff9440'], bar: '#0a0c11' },
  { key: 'light', label: 'Light', blurb: 'Bright and clean', swatch: ['#f2f3f7', '#ffffff', '#ff4d2e', '#ff9440'], bar: '#f2f3f7' },
  { key: 'electric', label: 'Electric', blurb: 'Navy and yellow', swatch: ['#060b1f', '#162250', '#ffcb05', '#3d68e0'], bar: '#060b1f' },
  { key: 'holo', label: 'Holo', blurb: 'Purple and pink', swatch: ['#0d0716', '#221538', '#a64dff', '#ff4fa3'], bar: '#0d0716' },
  { key: 'forest', label: 'Forest', blurb: 'Deep green and lime', swatch: ['#07110c', '#15281d', '#34c76f', '#b6e34a'], bar: '#07110c' },
]

const KEY = 'slowtcg-theme'

export function getTheme(): ThemeKey {
  try {
    const t = localStorage.getItem(KEY) as ThemeKey | null
    if (t && THEMES.some((x) => x.key === t)) return t
  } catch {
    /* storage unavailable: fall back to auto */
  }
  return 'auto'
}

export function applyTheme(key: ThemeKey) {
  const root = document.documentElement
  if (key === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', key)
  try {
    localStorage.setItem(KEY, key)
  } catch {
    /* choice just won't persist */
  }
  // Keep the browser / status bar color in step with the page.
  const bar = THEMES.find((t) => t.key === key)?.bar
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', bar || getComputedStyle(root).getPropertyValue('--bg').trim() || '#0a0c11')
}

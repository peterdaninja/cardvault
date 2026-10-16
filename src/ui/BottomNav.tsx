import { GearIcon, HomeIcon, ScanIcon, StackIcon } from './icons'

export type Tab = 'home' | 'collections' | 'settings'

interface Props {
  tab: Tab
  onTab: (t: Tab) => void
  onScan: () => void
}

export default function BottomNav({ tab, onTab, onScan }: Props) {
  const item = (t: Tab, label: string, icon: React.ReactNode) => (
    <button className={tab === t ? 'on' : ''} onClick={() => onTab(t)}>
      {icon}
      <span>{label}</span>
    </button>
  )
  return (
    <nav className="nav">
      {item('home', 'Home', <HomeIcon />)}
      {item('collections', 'Collections', <StackIcon />)}
      <button className="scan" onClick={onScan}>
        <ScanIcon />
        <span>Scan</span>
      </button>
      {item('settings', 'Settings', <GearIcon />)}
    </nav>
  )
}

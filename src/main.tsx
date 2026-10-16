import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './themes.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'
import { applyTheme, getTheme } from './lib/theme'

applyTheme(getTheme())

// Check for a new version on every launch and reload into it automatically.
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

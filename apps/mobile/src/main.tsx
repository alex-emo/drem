import './lib/compat.js'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { ErrorBoundary } from './app/ErrorBoundary.js'
import { setupTheme } from './app/theme.js'
import { setupNativeKeyboard } from './app/viewport.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupTheme()
setupNativeKeyboard()

createRoot(document.getElementById('root') as HTMLElement).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)

import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { store } from './core/store'
import { getCommand } from './core/commands'

createRoot(document.getElementById('root')!).render(<App />)

// Test/automation hook (also handy from DevTools).
;(window as any).__hrvcad = { store, getCommand }

import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import App from './App.jsx'
import './styles.css'

// `npx convex dev` writes VITE_CONVEX_URL to .env.local. If it's missing we
// still build a (broken) client — App.jsx surfaces a setup notice — so that
// Vite doesn't tree-shake the entire app out of the production bundle.
const convexUrl = import.meta.env.VITE_CONVEX_URL || 'https://hommies-portal-not-linked.convex.cloud'
const convex = new ConvexReactClient(convexUrl)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </React.StrictMode>,
)

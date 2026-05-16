import React from 'react'
import { useQuery } from 'convex/react'
import AddProperty from './components/AddProperty.jsx'
import StatusScreen from './components/Status.jsx'
import RecommendScreen from './components/Recommend.jsx'
import ListingsScreen from './components/Listings.jsx'
import { Toast, Icon } from './components/ui.jsx'
import logoUrl from './assets/logo.png'

// The portal shell — navy left sidebar on desktop, off-canvas drawer on
// mobile (triggered by the hamburger button in the mobile top bar). The
// nav order IS the workflow; the portal opens straight onto Add Property.

const NAV = [
  { id: 'add', label: 'Add Property', step: 1 },
  { id: 'status', label: 'Status', step: 2 },
  { id: 'recommend', label: 'Recommend', step: 3 },
  { id: 'listings', label: 'Listings', step: 4 },
]

export default function App() {
  const [active, setActive] = React.useState('add')
  const [toastMsg, setToastMsg] = React.useState('')
  const [navOpen, setNavOpen] = React.useState(false)
  const toast = (m) => setToastMsg(m)

  const linked = !!import.meta.env.VITE_CONVEX_URL
  const properties = useQuery('properties:list') ?? []
  const responses = useQuery('responses:list') ?? []

  if (!linked) return <NotLinkedNotice />

  const counts = {
    add: '',
    status: properties.length,
    recommend: responses.length,
    listings: properties.length,
  }

  const today = new Date().toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  // Close the drawer whenever the user picks a nav item.
  function pickScreen(id) {
    setActive(id)
    setNavOpen(false)
  }

  // Lock body scroll while the drawer is open so the page underneath
  // doesn't scroll behind it on mobile.
  React.useEffect(() => {
    if (navOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = prev
      }
    }
  }, [navOpen])

  const activeLabel = NAV.find((n) => n.id === active)?.label || ''

  return (
    <div className="app">
      {/* Mobile top bar — hidden on desktop via CSS. */}
      <div className="mobile-top">
        <button
          type="button"
          className="mobile-top-btn"
          onClick={() => setNavOpen((o) => !o)}
          aria-label={navOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={navOpen}
        >
          <Icon name="menu" size={20} />
        </button>
        <div className="mobile-top-brand">
          <img src={logoUrl} alt="hommies.sg" className="brand-logo brand-logo--sm" />
        </div>
        <div className="mobile-top-screen">· {activeLabel}</div>
      </div>

      <aside className={`sidebar ${navOpen ? 'sidebar--open' : ''}`}>
        <div className="brand">
          <img src={logoUrl} alt="hommies.sg" className="brand-logo" />
          <div className="brand-sub">Internal operations portal</div>
        </div>

        <div>
          <div className="nav-label">Workflow</div>
          <div className="nav">
            {NAV.map((n) => (
              <button
                key={n.id}
                className={`nav-item ${active === n.id ? 'active' : ''}`}
                onClick={() => pickScreen(n.id)}
                type="button"
              >
                <span className="nav-step">{n.step}</span>
                {n.label}
                {counts[n.id] !== '' && <span className="nav-count">{counts[n.id]}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-foot">
          <strong>Housemates becoming homies.</strong>
          <br />
          We connect students with authorized agents — we are not agents.
        </div>
      </aside>

      {/* Backdrop only renders / fires on mobile when the drawer is open. */}
      {navOpen && (
        <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />
      )}

      <main className="main" data-screen-label={active}>
        {active === 'add' && (
          <AddProperty toast={toast} onSaved={() => setActive('status')} properties={properties} />
        )}
        {active === 'status' && <StatusScreen toast={toast} properties={properties} />}
        {active === 'recommend' && (
          <RecommendScreen toast={toast} properties={properties} responses={responses} />
        )}
        {active === 'listings' && <ListingsScreen properties={properties} />}

        <div className="footer-strip">
          <span>
            We connect students with authorized agents — <strong>we are not agents</strong>.
          </span>
          <span>Hommies.sg · internal · {today}</span>
        </div>
      </main>

      <Toast msg={toastMsg} onDone={() => setToastMsg('')} />
    </div>
  )
}

function NotLinkedNotice() {
  return (
    <div style={{ padding: 40, maxWidth: 640, margin: '0 auto', color: 'var(--ink)' }}>
      <div className="eyebrow">Setup</div>
      <h1 className="page-title" style={{ marginBottom: 12 }}>
        Backend not linked
      </h1>
      <p className="muted">
        <code>VITE_CONVEX_URL</code> is not set. Run <code>npx convex dev</code> once in this repo to provision and link a
        Convex deployment, then restart <code>npm run dev</code>.
      </p>
    </div>
  )
}

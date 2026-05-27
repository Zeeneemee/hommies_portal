import React from 'react'
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from 'convex/react'
import AddProperty from './components/AddProperty.jsx'
import StatusScreen from './components/Status.jsx'
import RecommendScreen from './components/Recommend.jsx'
import ListingsScreen from './components/Listings.jsx'
import CustomersScreen from './components/Customers.jsx'
import { Toast, Icon } from './components/ui.jsx'
import logoUrl from './assets/logo.png'

// The portal shell — navy left sidebar on desktop, off-canvas drawer on
// mobile (triggered by the hamburger button in the mobile top bar). URL
// routes drive the active screen — refresh / share / back-button all work.
// The nav order is the workflow; the portal opens straight onto Add Property.

const NAV = [
  { id: 'add', to: '/add', label: 'Add Property', step: 1 },
  { id: 'status', to: '/status', label: 'Status', step: 2 },
  { id: 'recommend', to: '/recommend', label: 'Recommend', step: 3 },
  { id: 'listings', to: '/listings', label: 'Listings', step: 4 },
  { id: 'customers', to: '/customers', label: 'Customers', step: 5 },
]

// Add-Property draft, held at the App level so it survives sidebar
// navigation — switching tabs unmounts the AddProperty screen, so its
// own useState would wipe the form. condo is mirrored to localStorage so
// a refresh keeps the name too; File blobs can't be serialized cleanly
// and stay in-memory only.
const DRAFT_CONDO_KEY = 'hommies.addProperty.condo'
function useAddPropertyDraft() {
  const [condo, setCondo] = React.useState(() => {
    try { return window.localStorage.getItem(DRAFT_CONDO_KEY) || '' } catch { return '' }
  })
  const [images, setImages] = React.useState([])
  const [posterFile, setPosterFile] = React.useState(null)
  // Optional walk-through video. In-memory only, like posterFile — File blobs
  // can't be serialized, so a refresh drops it.
  const [videoFile, setVideoFile] = React.useState(null)
  // Fields lifted from a pasted PropertyGuru link — passed through to
  // properties:add on save. In-memory only; not persisted across reloads.
  const [extracted, setExtracted] = React.useState(null)
  // The PG project page URL associated with the listing (e.g.
  // propertyguru.com.sg/project/lake-grande). When present, the poster
  // generator scrapes it server-side for verified facilities/nearby copy.
  const [projectUrl, setProjectUrl] = React.useState(null)
  React.useEffect(() => {
    try {
      if (condo) window.localStorage.setItem(DRAFT_CONDO_KEY, condo)
      else window.localStorage.removeItem(DRAFT_CONDO_KEY)
    } catch { /* private mode etc. — ignore */ }
  }, [condo])
  const reset = React.useCallback(() => {
    setImages((prev) => {
      prev.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl))
      return []
    })
    setCondo('')
    setPosterFile(null)
    setVideoFile(null)
    setExtracted(null)
    setProjectUrl(null)
    try { window.localStorage.removeItem(DRAFT_CONDO_KEY) } catch {}
  }, [])
  return {
    condo, setCondo,
    images, setImages,
    posterFile, setPosterFile,
    videoFile, setVideoFile,
    extracted, setExtracted,
    projectUrl, setProjectUrl,
    reset,
  }
}

export default function App() {
  const [toastMsg, setToastMsg] = React.useState('')
  const [navOpen, setNavOpen] = React.useState(false)
  const toast = (m) => setToastMsg(m)
  const location = useLocation()
  const navigate = useNavigate()
  const addDraft = useAddPropertyDraft()

  const linked = !!import.meta.env.VITE_CONVEX_URL
  const properties = useQuery('properties:list') ?? []
  const responses = useQuery('responses:list') ?? []

  if (!linked) return <NotLinkedNotice />

  const counts = {
    add: '',
    status: properties.length,
    recommend: responses.length,
    listings: properties.length,
    customers: responses.length,
  }

  const today = new Date().toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  const activeLabel = React.useMemo(() => {
    const hit = NAV.find((n) => location.pathname.startsWith(n.to))
    return hit?.label || ''
  }, [location.pathname])

  // Close the drawer whenever a nav item is picked.
  const closeNav = () => setNavOpen(false)

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
              <NavLink
                key={n.id}
                to={n.to}
                onClick={closeNav}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              >
                <span className="nav-step">{n.step}</span>
                {n.label}
                {counts[n.id] !== '' && <span className="nav-count">{counts[n.id]}</span>}
              </NavLink>
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
        <div className="sidebar-backdrop" onClick={closeNav} aria-hidden="true" />
      )}

      <main className="main" data-screen-label={activeLabel}>
        <Routes>
          <Route path="/" element={<Navigate to="/add" replace />} />
          <Route
            path="/add"
            element={
              <AddProperty
                toast={toast}
                onSaved={() => navigate('/status')}
                properties={properties}
                draft={addDraft}
              />
            }
          />
          <Route path="/status" element={<StatusScreen toast={toast} properties={properties} />} />
          <Route
            path="/recommend"
            element={
              <RecommendScreen toast={toast} properties={properties} responses={responses} />
            }
          />
          <Route path="/listings" element={<ListingsScreen properties={properties} toast={toast} />} />
          <Route
            path="/customers"
            element={<CustomersScreen toast={toast} responses={responses} />}
          />
          <Route path="*" element={<Navigate to="/add" replace />} />
        </Routes>

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

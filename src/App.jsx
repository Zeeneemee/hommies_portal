import React from 'react'
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from 'convex/react'
import AddProperty from './components/AddProperty.jsx'
import AddPropertyChat from './components/AddPropertyChat.jsx'
import StatusScreen from './components/Status.jsx'
import RecommendScreen from './components/Recommend.jsx'
import ListingsScreen from './components/Listings.jsx'
import CustomersScreen from './components/Customers.jsx'
import CustomerDetail from './components/CustomerDetail.jsx'
import SalesScreen from './components/Sales.jsx'
import PipelineScreen from './components/Pipeline.jsx'
import { Toast, Icon } from './components/ui.jsx'
import logoUrl from './assets/logo.png'

// The portal shell — navy left sidebar on desktop, off-canvas drawer on
// mobile (triggered by the hamburger button in the mobile top bar). URL
// routes drive the active screen — refresh / share / back-button all work.
// The nav order is the workflow; the portal opens straight onto Add Property.

const CHAT_INTAKE_ENABLED = import.meta.env.VITE_ENABLE_CHAT_INTAKE === 'true'

// Resets window scroll to the top whenever the route changes. Without this
// react-router preserves the previous page's scroll position, which feels
// broken when navigating from a deep customer detail back to the list.
function ScrollToTop() {
  const { pathname } = useLocation()
  React.useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

const NAV = [
  { id: 'add', to: '/add', label: 'Add Property', step: 1 },
  ...(CHAT_INTAKE_ENABLED
    ? [{ id: 'add-chat', to: '/add/chat', label: 'Add (chat) · beta', step: '★' }]
    : []),
  { id: 'status', to: '/status', label: 'Status', step: 2 },
  { id: 'recommend', to: '/recommend', label: 'Recommend', step: 3 },
  { id: 'listings', to: '/listings', label: 'Listings', step: 4 },
  { id: 'customers', to: '/customers', label: 'Customers', step: 5 },
  { id: 'pipeline', to: '/pipeline', label: 'Pipeline', step: 6 },
  { id: 'sales', to: '/sales', label: 'Sales', step: 7 },
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

// Batch Add draft — lifted to App so navigation doesn't unmount BatchAddProperty.
// JSON-safe slice (URLs, extracted/edited fields, status, condo, primaryUni,
// savedPropertyId, error, lastEditedAt, posterGeneratedAt) is mirrored to
// localStorage. Image files and poster blobs are in-memory only — on refresh,
// any row that depended on them resets to `queued` so re-extraction is one click.
const BATCH_KEY = 'hommies.batchAdd.v1'
const BATCH_SAFE_STATUSES = new Set(['queued', 'failed', 'saved', 'save_failed'])
function useBatchAddDraft() {
  const [urlInput, setUrlInput] = React.useState('')
  const [maxParallel, setMaxParallel] = React.useState(1)
  const [rows, setRows] = React.useState(() => {
    try {
      const raw = window.localStorage.getItem(BATCH_KEY)
      if (!raw) return []
      const data = JSON.parse(raw)
      if (!Array.isArray(data?.rows)) return []
      return data.rows.map((r) => ({
        id: r.id,
        url: r.url,
        // After refresh, ready / generating_poster / saving rows lose their
        // blobs — fall back to queued so the worker re-extracts.
        status: BATCH_SAFE_STATUSES.has(r.status) ? r.status : 'queued',
        extracted: r.extracted || null,
        condo: r.condo || '',
        images: [],
        posterFile: null,
        posterPreviewUrl: null,
        projectUrl: r.projectUrl || null,
        primaryUni: r.primaryUni || null,
        savedPropertyId: r.savedPropertyId || null,
        error: r.error || null,
        skippedReason: null,
        lastEditedAt: r.lastEditedAt || 0,
        posterGeneratedAt: 0,
        isExpanded: false,
      }))
    } catch { return [] }
  })
  React.useEffect(() => {
    try {
      const safe = rows.map((r) => ({
        id: r.id,
        url: r.url,
        status: r.status,
        extracted: r.extracted,
        condo: r.condo,
        projectUrl: r.projectUrl,
        primaryUni: r.primaryUni,
        savedPropertyId: r.savedPropertyId,
        error: r.error,
        lastEditedAt: r.lastEditedAt,
      }))
      window.localStorage.setItem(BATCH_KEY, JSON.stringify({ rows: safe }))
    } catch { /* quota / private mode — ignore */ }
  }, [rows])
  const reset = React.useCallback(() => {
    setRows([])
    setUrlInput('')
    try { window.localStorage.removeItem(BATCH_KEY) } catch {}
  }, [])
  return { rows, setRows, urlInput, setUrlInput, maxParallel, setMaxParallel, reset }
}

export default function App() {
  const [toastMsg, setToastMsg] = React.useState('')
  const [navOpen, setNavOpen] = React.useState(false)
  const toast = (m) => setToastMsg(m)
  const location = useLocation()
  const navigate = useNavigate()
  const addDraft = useAddPropertyDraft()
  const batchDraft = useBatchAddDraft()

  const linked = !!import.meta.env.VITE_CONVEX_URL
  const properties = useQuery('properties:list') ?? []
  const responses = useQuery('responses:list') ?? []
  const deals = useQuery('deals:list') ?? []
  const movedInCount = deals.filter(
    (d) => d.stage === 'moved_in' && d.cancelledAt === undefined,
  ).length
  const inFlightDealCount = deals.filter((d) => d.cancelledAt === undefined && d.stage !== 'moved_in').length

  if (!linked) return <NotLinkedNotice />

  const counts = {
    add: batchDraft.rows.length || '',
    'add-chat': '',
    status: properties.length,
    recommend: responses.length,
    listings: properties.length,
    customers: responses.length,
    pipeline: inFlightDealCount,
    sales: movedInCount,
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

      <ScrollToTop />
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
                batchDraft={batchDraft}
              />
            }
          />
          <Route
            path="/add/chat"
            element={
              CHAT_INTAKE_ENABLED ? (
                <AddPropertyChat
                  toast={toast}
                  onSaved={() => navigate('/status')}
                  draft={addDraft}
                />
              ) : (
                <Navigate to="/add" replace />
              )
            }
          />
          <Route path="/add/batch" element={<Navigate to="/add" replace />} />
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
            element={<CustomersScreen toast={toast} responses={responses} properties={properties} />}
          />
          <Route
            path="/customers/:id"
            element={<CustomerDetail toast={toast} responses={responses} properties={properties} />}
          />
          <Route
            path="/pipeline"
            element={<PipelineScreen toast={toast} properties={properties} />}
          />
          <Route path="/sales" element={<SalesScreen toast={toast} deals={deals} />} />
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

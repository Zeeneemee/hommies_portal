import React from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useNavigate } from 'react-router-dom'
import { Pill, StatusPill, Icon } from './ui.jsx'
import ListingEditModal from './ListingEditModal.jsx'

// A property is "orphan" when it has been around long enough to plausibly
// have been pinned/sent yet has zero active assignments. Clock starts at
// posterExtractedAt (the moment it became matchable) or createdAt as a
// fallback for legacy rows. 3 days is coded, not configured — until we
// have evidence the right number is operator-specific.
const ORPHAN_AGE_MS = 3 * 24 * 60 * 60 * 1000

export function isOrphan(property, assignments) {
  const start = property.posterExtractedAt ?? property.createdAt
  if (!start) return false
  if (Date.now() - start < ORPHAN_AGE_MS) return false
  const hasActive = (assignments || []).some(
    (a) => a.propertyId === property._id && a.unpinnedAt === undefined,
  )
  return !hasActive
}

// Screen 4 — card-based inventory of every property the portal is holding.
// Each card supports inline CRUD: edit fields via the modal (properties:update),
// advance / reopen the pipeline status (properties:advanceStatus — same mutation
// the Status screen uses, so the two screens stay in sync via Convex's reactive
// useQuery), and delete (properties:remove, which also cleans up the poster
// from storage).
export default function ListingsScreen({ properties, toast }) {
  const [filter, setFilter] = React.useState('All')
  const [editingId, setEditingId] = React.useState(null)
  const assignments = useQuery('assignments:list', {}) ?? []
  const navigate = useNavigate()

  const filtered = properties.filter((p) => {
    if (filter === 'All') return true
    if (filter === 'Pending poster') return !p.posterStorageId
    return p.buildingType === filter
  })
  const count = (kind) => {
    if (kind === 'All') return properties.length
    if (kind === 'Pending poster') return properties.filter((p) => !p.posterStorageId).length
    return properties.filter((p) => p.buildingType === kind).length
  }
  const editing = editingId ? properties.find((p) => p._id === editingId) : null

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Step 4 · Inventory</div>
          <h1 className="page-title">Listings</h1>
          <p className="page-sub">
            Every property as its collection of assets — photos, poster, and the facts lifted from the poster.
            Use the per-card buttons to edit, advance status, or remove.
          </p>
        </div>
      </div>

      <div className="listings-bar">
        <div className="filter-chips">
          {['All', 'Condo', 'HDB', 'Pending poster'].map((f) => (
            <button
              key={f}
              type="button"
              className={`filter-chip ${filter === f ? 'on' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f} ({count(f)})
            </button>
          ))}
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
          {filtered.length} of {properties.length} shown
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="empty">
          <h4>Nothing here yet</h4>
          <p>Add a property to start an inventory.</p>
        </div>
      )}

      <div className="listings-grid">
        {filtered.map((p) => (
          <ListingCard
            key={p._id}
            property={p}
            orphan={isOrphan(p, assignments)}
            onEdit={() => setEditingId(p._id)}
            onOpenInRecommend={() => navigate(`/recommend?property=${p._id}`)}
            toast={toast}
          />
        ))}
      </div>

      {editing && (
        <ListingEditController
          property={editing}
          onClose={() => setEditingId(null)}
          toast={toast}
        />
      )}
    </div>
  )
}

// Holds the update mutation outside the card so closing the modal cancels
// any in-flight thinking cleanly without unmounting the card itself.
function ListingEditController({ property, onClose, toast }) {
  const update = useMutation('properties:update')
  async function handleSave(patch) {
    try {
      await update({ id: property._id, patch })
      toast?.(`${property.condo} updated.`)
      onClose()
    } catch (err) {
      toast?.(`Update failed: ${err.message || err}`)
    }
  }
  return <ListingEditModal property={property} onClose={onClose} onSave={handleSave} />
}

function ListingCard({ property: p, orphan, onEdit, onOpenInRecommend, toast }) {
  const advanceStatus = useMutation('properties:advanceStatus')
  const removeProperty = useMutation('properties:remove')
  const [busy, setBusy] = React.useState(false)
  const images = p.images || []
  const hero = images[0]
  const rest = images.slice(1, 5)

  const advanceLabel =
    p.status === 'data_received'
      ? 'Attach poster on Status →'
      : p.status === 'poster_attached'
      ? 'Mark sent'
      : 'Reopen'

  const canAdvance = p.status !== 'data_received'

  async function handleAdvance() {
    if (!canAdvance) {
      toast?.('Attach a poster on the Status screen before advancing.')
      return
    }
    setBusy(true)
    try {
      await advanceStatus({ id: p._id })
      toast?.(
        p.status === 'poster_attached' ? 'Marked as sent.' : 'Reopened for redispatch.',
      )
    } catch (err) {
      toast?.(`Status change failed: ${err.message || err}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${p.condo}"? This removes the property and its poster from storage.`)) {
      return
    }
    setBusy(true)
    try {
      await removeProperty({ id: p._id })
      toast?.(`${p.condo} deleted.`)
    } catch (err) {
      toast?.(`Delete failed: ${err.message || err}`)
      setBusy(false)
    }
    // No setBusy(false) on success — the card is about to unmount.
  }

  return (
    <div key={p._id} className="listing">
      {/* Hero — first uploaded image, or placeholder — with badges overlaid. */}
      <div style={{ position: 'relative' }}>
        {hero?.url ? (
          <img className="listing-hero-img" src={hero.url} alt={hero.name} />
        ) : (
          <div className="listing-hero-placeholder">
            <Icon name="photo" size={28} /> &nbsp;No photos yet
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            right: 10,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {p.buildingType && <Pill kind="navy">{p.buildingType}</Pill>}
            {p.posterStorageId ? (
              <Pill kind="green" dot>
                Poster ready
              </Pill>
            ) : (
              <Pill kind="warn" dot>
                No poster
              </Pill>
            )}
            {orphan && (
              <button
                type="button"
                className="orphan-pill"
                onClick={onOpenInRecommend}
                title="3+ days old with no pinned or sent recipients. Click to open in Recommend."
              >
                <i className="dot" />
                Orphan — needs recipients
              </button>
            )}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--ink)',
              background: 'rgba(255,255,255,0.92)',
              padding: '3px 8px',
              borderRadius: 100,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontWeight: 600,
            }}
          >
            <Icon name="photo" size={11} /> {images.length}
          </div>
        </div>
      </div>

      {/* Thumbnail strip of remaining images. */}
      {rest.length > 0 && (
        <div className="listing-thumbs">
          {rest.map((img) => (
            <img key={img.storageId} src={img.url} alt={img.name} className="listing-thumb" />
          ))}
          {images.length > 5 && (
            <div className="listing-thumb" style={{ display: 'grid', placeItems: 'center', fontSize: 11, color: 'var(--ink-soft)', fontWeight: 600 }}>
              +{images.length - 5}
            </div>
          )}
        </div>
      )}

      <div className="listing-body">
        <div className="listing-name">{p.condo}</div>

        <div className="listing-foot">
          <div className="rent">
            {p.rentSGD ? (
              <>
                S${p.rentSGD}
                <span className="pm"> /mo</span>
              </>
            ) : (
              <span style={{ fontSize: 14, color: 'var(--ink-mute)' }}>Rent —</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {p.posterUrl && (
              <a className="listing-poster-link" href={p.posterUrl} target="_blank" rel="noreferrer">
                <Icon name="pdf" size={12} /> Open poster
              </a>
            )}
            <StatusPill status={p.status} />
          </div>
        </div>

        <div className="listing-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onEdit}
            disabled={busy}
          >
            Edit
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleAdvance}
            disabled={busy || !canAdvance}
            title={canAdvance ? '' : 'Attach a poster on the Status screen first.'}
          >
            {p.status === 'poster_attached' && <Icon name="check" size={12} />} {advanceLabel}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-danger"
            onClick={handleDelete}
            disabled={busy}
          >
            <Icon name="trash" size={12} /> Delete
          </button>
        </div>
      </div>
    </div>
  )
}

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
  const [search, setSearch] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [rentMin, setRentMin] = React.useState('')
  const [rentMax, setRentMax] = React.useState('')
  const [housing, setHousing] = React.useState('All')
  const [statusFilter, setStatusFilter] = React.useState('All')
  const [editingId, setEditingId] = React.useState(null)
  const assignments = useQuery('assignments:list', {}) ?? []
  const deals = useQuery('deals:list', {}) ?? []
  const closedSet = React.useMemo(
    () =>
      new Set(
        deals
          .filter((d) => d.stage === 'moved_in' && d.cancelledAt === undefined)
          .map((d) => d.propertyId),
      ),
    [deals],
  )
  const navigate = useNavigate()

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 200)
    return () => clearTimeout(t)
  }, [search])

  const matchesChip = (p) => {
    if (filter === 'All') return true
    if (filter === 'Pending poster') return !p.posterStorageId
    if (filter === 'Taken') return closedSet.has(p._id)
    return p.buildingType === filter
  }
  const matchesSearch = (p) => {
    if (!debouncedSearch) return true
    const hay = [p.condo, p.area, p.unitType, p.rentSGD != null ? String(p.rentSGD) : '']
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(debouncedSearch)
  }
  const matchesRent = (p) => {
    const min = rentMin === '' ? null : Number(rentMin)
    const max = rentMax === '' ? null : Number(rentMax)
    if (min == null && max == null) return true
    if (p.rentSGD == null) return false
    if (min != null && p.rentSGD < min) return false
    if (max != null && p.rentSGD > max) return false
    return true
  }
  const matchesHousing = (p) => housing === 'All' || p.housingType === housing
  const matchesStatus = (p) => statusFilter === 'All' || p.status === statusFilter

  const filtered = properties.filter(
    (p) =>
      matchesChip(p) &&
      matchesSearch(p) &&
      matchesRent(p) &&
      matchesHousing(p) &&
      matchesStatus(p),
  )
  const count = (kind) => {
    if (kind === 'All') return properties.length
    if (kind === 'Pending poster') return properties.filter((p) => !p.posterStorageId).length
    if (kind === 'Taken') return properties.filter((p) => closedSet.has(p._id)).length
    return properties.filter((p) => p.buildingType === kind).length
  }
  const editing = editingId ? properties.find((p) => p._id === editingId) : null

  const advancedActive =
    rentMin !== '' || rentMax !== '' || housing !== 'All' || statusFilter !== 'All'
  const filtersActive = debouncedSearch !== '' || advancedActive || filter !== 'All'
  const [showAdvanced, setShowAdvanced] = React.useState(false)
  React.useEffect(() => {
    if (advancedActive) setShowAdvanced(true)
  }, [advancedActive])

  const clearFilters = () => {
    setFilter('All')
    setSearch('')
    setRentMin('')
    setRentMax('')
    setHousing('All')
    setStatusFilter('All')
  }

  const chipDefs = [
    { key: 'All' },
    { key: 'Condo' },
    { key: 'HDB' },
    { key: 'Pending poster' },
    { key: 'Taken', tone: 'danger' },
  ]

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Listings</h1>
          <p className="page-sub">
            Every property as its collection of assets — photos, poster, and the facts lifted from the poster.
            Use the per-card buttons to edit, advance status, or remove.
          </p>
        </div>
      </div>

      <div className="listings-bar">
        <div className="listings-search-row">
          <span className="listings-search-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          <input
            type="search"
            className="listings-search"
            placeholder="Search condo, area, unit type, or rent…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            className={`more-filters-toggle ${showAdvanced ? 'on' : ''} ${advancedActive ? 'has-active' : ''}`}
            onClick={() => setShowAdvanced((s) => !s)}
            aria-expanded={showAdvanced}
            aria-label="Toggle more filters"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M6 12h12M10 18h4" />
            </svg>
            <span className="more-filters-label">Filters</span>
            {advancedActive && <span className="more-filters-dot" aria-hidden="true" />}
          </button>
        </div>

        <div className="filter-chips chip-rail" role="tablist" aria-label="Quick filters">
          {chipDefs.map(({ key, tone }) => {
            const active = filter === key
            const n = count(key)
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                className={`filter-chip ${active ? 'on' : ''} ${tone ? `tone-${tone}` : ''}`}
                onClick={() => setFilter(key)}
              >
                <span className="chip-label">{key}</span>
                <span className="chip-count">{n}</span>
              </button>
            )
          })}
        </div>

        {showAdvanced && (
          <div className="listings-extra-filters" id="advanced-filters">
            <div className="rent-range">
              <input
                type="number"
                inputMode="numeric"
                min="0"
                className="input input-sm"
                placeholder="Min S$"
                value={rentMin}
                onChange={(e) => setRentMin(e.target.value)}
                aria-label="Minimum rent"
              />
              <span className="rent-range-sep">–</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                className="input input-sm"
                placeholder="Max S$"
                value={rentMax}
                onChange={(e) => setRentMax(e.target.value)}
                aria-label="Maximum rent"
              />
            </div>
            <select
              className="select select-sm"
              value={housing}
              onChange={(e) => setHousing(e.target.value)}
              aria-label="Housing type"
            >
              <option value="All">Housing: All</option>
              <option value="Room">Room</option>
              <option value="Whole Unit">Whole Unit</option>
            </select>
            <select
              className="select select-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Status"
            >
              <option value="All">Status: All</option>
              <option value="data_received">Data received</option>
              <option value="poster_attached">Poster attached</option>
              <option value="sent">Sent</option>
            </select>
          </div>
        )}

        <div className="listings-bar-foot">
          <div className="listings-count">
            {filtered.length} of {properties.length} shown
          </div>
          {filtersActive && (
            <button type="button" className="link-btn" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="empty">
          <h4>{filtersActive ? 'No listings match your filters' : 'Nothing here yet'}</h4>
          <p>
            {filtersActive
              ? 'Clear filters to see everything.'
              : 'Add a property to start an inventory.'}
          </p>
          {filtersActive && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters} style={{ marginTop: 10 }}>
              Clear filters
            </button>
          )}
        </div>
      )}

      <div className="listings-grid">
        {filtered.map((p) => (
          <ListingCard
            key={p._id}
            property={p}
            orphan={isOrphan(p, assignments)}
            closed={closedSet.has(p._id)}
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
  return <ListingEditModal property={property} onClose={onClose} onSave={handleSave} toast={toast} />
}

function ListingCard({ property: p, orphan, closed, onEdit, onOpenInRecommend, toast }) {
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
    if (
      !window.confirm(
        `Delete "${p.condo}"? This removes the property, its poster, and its video from storage.`,
      )
    ) {
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

  // Hero priority: first image → walk-through video (first frame as poster)
  // → "No media yet" placeholder. The video-as-hero path lets a property
  // saved with just a name + video still look like a real card.
  const heroVideo = !hero?.url && p.videoUrl ? { url: p.videoUrl, name: p.videoName } : null

  return (
    <div key={p._id} className="listing">
      {/* Hero — first uploaded image, or video, or placeholder — with badges overlaid. */}
      <div className="listing-hero-wrap" style={{ position: 'relative' }}>
        {hero?.url ? (
          <>
            <img className="listing-hero-img" src={hero.url} alt={hero.name} />
            <MediaActions url={hero.url} name={hero.name} />
          </>
        ) : heroVideo ? (
          <>
            <video
              className="listing-hero-img"
              src={heroVideo.url}
              controls
              preload="metadata"
              playsInline
            />
            <MediaActions url={heroVideo.url} name={heroVideo.name} />
          </>
        ) : (
          <div className="listing-hero-placeholder">
            <Icon name="photo" size={28} /> &nbsp;No media yet
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
            {closed && (
              <Pill kind="danger" dot>
                <Icon name="check" size={10} /> Closed sale
              </Pill>
            )}
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
            <span key={img.storageId} className="listing-thumb-wrap">
              <img src={img.url} alt={img.name} className="listing-thumb" />
              <MediaActions url={img.url} name={img.name} />
            </span>
          ))}
          {images.length > 5 && (
            <div className="listing-thumb" style={{ display: 'grid', placeItems: 'center', fontSize: 11, color: 'var(--ink-soft)', fontWeight: 600 }}>
              +{images.length - 5}
            </div>
          )}
        </div>
      )}

      {/* Video slot — only when the video isn't already shown as the hero.
          Always rendered otherwise (including the muted "No video" state) so
          the absence is visible. */}
      {!heroVideo && <VideoSlot videoUrl={p.videoUrl} name={p.videoName} />}


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

function MediaActions({ url, name }) {
  if (!url) return null
  const stop = (e) => e.stopPropagation()
  return (
    <div className="media-actions" onClick={stop}>
      <a
        className="media-action"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={stop}
        title="Open in new tab"
        aria-label={`Open ${name || 'media'} in new tab`}
      >
        <Icon name="external" size={13} />
      </a>
      <a
        className="media-action"
        href={url}
        download={name || ''}
        onClick={stop}
        title="Download"
        aria-label={`Download ${name || 'media'}`}
      >
        <Icon name="download" size={13} />
      </a>
    </div>
  )
}

function VideoSlot({ videoUrl, name }) {
  if (!videoUrl) {
    return (
      <div className="listing-video muted">
        <span className="icon-wrap"><Icon name="video" size={14} /></span>
        <span className="name">No video</span>
      </div>
    )
  }
  return (
    <div className="listing-video">
      <span className="icon-wrap"><Icon name="play" size={14} /></span>
      <span className="name" title={name || ''}>{name || 'Walk-through video'}</span>
      <span className="actions">
        <a
          className="action"
          href={videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open video in new tab"
        >
          <Icon name="external" size={11} /> Open
        </a>
        <a
          className="action"
          href={videoUrl}
          download={name || ''}
          title="Download video"
        >
          <Icon name="download" size={11} /> Download
        </a>
      </span>
    </div>
  )
}

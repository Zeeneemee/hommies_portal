import React from 'react'
import { Pill, StatusPill, Icon } from './ui.jsx'

// Screen 4 — card-based inventory of every property the portal is holding.
// As of simplify-add-property, each card renders the property as its
// collection of assets: the uploaded image gallery (hero + thumbnails), the
// poster (if attached), the four key facts as lifted from the poster (with
// "—" placeholders when extraction hasn't run / didn't find them), the rent
// when known, and the dispatch pill.
export default function ListingsScreen({ properties }) {
  const [filter, setFilter] = React.useState('All')

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

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Step 4 · Inventory</div>
          <h1 className="page-title">Listings</h1>
          <p className="page-sub">
            Every property as its collection of assets — photos, poster, and the facts lifted from the poster.
            Properties still waiting for poster extraction show "—" in place of any missing fact.
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
          <ListingCard key={p._id} property={p} />
        ))}
      </div>
    </div>
  )
}

function ListingCard({ property: p }) {
  const images = p.images || []
  const hero = images[0]
  const rest = images.slice(1, 5)
  const fallback = (v, suffix = '') => (v != null && v !== '' ? `${v}${suffix}` : '—')

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

        <div className="listing-facts">
          <Fact label="Room type" value={fallback(p.unitType)} />
          <Fact label="Building" value={fallback(p.buildingType)} />
          <Fact label="Area" value={fallback(p.area)} />
          <Fact label="Age" value={p.ageYears ? `${p.ageYears} yrs` : '—'} />
        </div>

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
      </div>
    </div>
  )
}

function Fact({ label, value }) {
  return (
    <div>
      <div className="fact-label">{label}</div>
      <div className="fact-val">{value}</div>
    </div>
  )
}

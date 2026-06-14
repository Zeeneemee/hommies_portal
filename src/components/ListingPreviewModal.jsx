import React from 'react'
import { Icon, StatusPill, Pill } from './ui.jsx'

// Read-only listing preview. Surfaced from the Recommend screen so the
// operator can see a property's media + details (photos, video, poster,
// specs) without leaving the matching flow. No mutations here — Edit /
// Advance / Delete live on the Listings card. Mirrors the visual language
// of ListingCard so the two feel like the same object.

const sgd = new Intl.NumberFormat('en-SG', { maximumFractionDigits: 0 })
function formatSGD(n) {
  return typeof n === 'number' && Number.isFinite(n) ? sgd.format(n) : String(n ?? '')
}

function Detail({ label, value }) {
  if (value == null || value === '') return null
  return (
    <div>
      <div className="fact-label">{label}</div>
      <div className="fact-val" style={{ fontSize: 14 }}>{value}</div>
    </div>
  )
}

export default function ListingPreviewModal({ property: p, onClose }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const images = p.images || []
  const hero = images[0]
  const rest = images.slice(1, 5)
  const heroVideo = !hero?.url && p.videoUrl ? { url: p.videoUrl, name: p.videoName } : null

  const commute = p.commuteMins
    ? ['NUS', 'NTU', 'SMU']
        .map((k) => (typeof p.commuteMins[k] === 'number' ? `${k} ${p.commuteMins[k]}m` : null))
        .filter(Boolean)
        .join(' · ')
    : ''

  const bedBath = [
    typeof p.bedrooms === 'number' ? `${p.bedrooms} bed${p.bedrooms === 1 ? '' : 's'}` : null,
    typeof p.bathrooms === 'number' ? `${p.bathrooms} bath${p.bathrooms === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(4,31,96,0.4)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 200,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 'min(620px, calc(100vw - 24px))', maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="card-head"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
        >
          <div>
            <h3 className="card-title">{p.condo}</h3>
            <p className="card-sub">
              Listing preview — read-only. Edit, status, and delete live on the Listings page.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="card-pad">
          {/* Hero — first image, else video, else placeholder. */}
          <div className="listing-hero-wrap" style={{ position: 'relative', marginBottom: 12 }}>
            {hero?.url ? (
              <img className="listing-hero-img" src={hero.url} alt={hero.name} />
            ) : heroVideo ? (
              <video className="listing-hero-img" src={heroVideo.url} controls preload="metadata" playsInline />
            ) : (
              <div className="listing-hero-placeholder">
                <Icon name="photo" size={28} /> &nbsp;No media yet
              </div>
            )}
            <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {p.buildingType && <Pill kind="navy">{p.buildingType}</Pill>}
              {p.posterStorageId ? (
                <Pill kind="green" dot>Poster ready</Pill>
              ) : (
                <Pill kind="warn" dot>No poster</Pill>
              )}
            </div>
          </div>

          {rest.length > 0 && (
            <div className="listing-thumbs" style={{ marginBottom: 12 }}>
              {rest.map((img) => (
                <a
                  key={img.storageId}
                  href={img.url}
                  target="_blank"
                  rel="noreferrer"
                  className="listing-thumb-wrap"
                  title="Open in new tab"
                >
                  <img src={img.url} alt={img.name} className="listing-thumb" />
                </a>
              ))}
              {images.length > 5 && (
                <div
                  className="listing-thumb"
                  style={{ display: 'grid', placeItems: 'center', fontSize: 11, color: 'var(--ink-soft)', fontWeight: 600 }}
                >
                  +{images.length - 5}
                </div>
              )}
            </div>
          )}

          {!heroVideo && p.videoUrl && (
            <div className="listing-video" style={{ marginBottom: 12 }}>
              <span className="icon-wrap"><Icon name="play" size={14} /></span>
              <span className="name" title={p.videoName || ''}>{p.videoName || 'Walk-through video'}</span>
              <span className="actions">
                <a className="action" href={p.videoUrl} target="_blank" rel="noopener noreferrer">
                  <Icon name="external" size={11} /> Open
                </a>
              </span>
            </div>
          )}

          <div className="recommend-fact-row" style={{ rowGap: 14 }}>
            <Detail
              label="Rent"
              value={typeof p.rentSGD === 'number' ? `S$${formatSGD(p.rentSGD)}/mo` : null}
            />
            <Detail label="Layout" value={bedBath || null} />
            <Detail label="Unit type" value={p.unitType} />
            <Detail label="Housing" value={p.housingType} />
            <Detail label="Area" value={p.area} />
            <Detail label="Age" value={typeof p.ageYears === 'number' ? `${p.ageYears} yrs` : null} />
            <Detail label="Commute" value={commute || null} />
            <Detail label="Address" value={p.fullAddress} />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
              marginTop: 16,
              paddingTop: 14,
              borderTop: '1px solid var(--hairline)',
            }}
          >
            <StatusPill status={p.status} />
            {p.posterUrl && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <a className="listing-poster-link" href={p.posterUrl} target="_blank" rel="noreferrer">
                  <Icon name="pdf" size={12} /> Open poster
                </a>
                <a
                  className="listing-poster-link"
                  href={p.posterUrl}
                  download={p.posterName || `${p.condo || 'poster'}.pdf`}
                  title="Download poster"
                >
                  <Icon name="download" size={12} /> Download
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

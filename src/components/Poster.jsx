import React from 'react'
import { theme } from '../theme.js'

// <Poster /> — three-page A4 portrait poster matching the
// /room-showcase-pdf skill output. Pages are siblings with the
// `html2pdf__page-break` class on every page except the last; html2pdf.js
// picks up that class and emits a page break before rendering the next div.
//
// Deterministic: same {property, content} → same DOM.
// Layout invariants live here; copy + photo order live in `content`.

const PAGE_W = 794
const PAGE_H = 1123
const PAGE_PAD_X = 56
const PAGE_PAD_TOP = 32
const PAGE_PAD_BOTTOM = 56

const ORANGE = theme.color.orange
const NAVY = theme.color.navy
const CREAM = theme.color.cream
const INK = theme.color.ink
const INK_SOFT = theme.color.inkSoft
const HAIRLINE = theme.color.hairlineStrong

// MRT line code → color. Used in the Nearby Transport block (dot before
// each station). Falls back to grey for unknowns.
const MRT_COLORS = {
  EW: '#009530', NS: '#d42e12', NE: '#9100c1', CC: '#fa9e0d',
  DT: '#005ec4', TE: '#9d5b25', CG: '#009530', BP: '#748477', CE: '#fa9e0d',
}

function mrtColor(code) {
  if (typeof code !== 'string') return '#666'
  const prefix = code.match(/^[A-Z]+/)
  return (prefix && MRT_COLORS[prefix[0]]) || '#666'
}

function formatRent(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  return `S$${n.toLocaleString('en-SG')}`
}

function imgUrl(property, idx) {
  const img = property.images?.[idx]
  return img?.url || img?.previewUrl || ''
}

function mapsDirUrl(origin, dest) {
  const o = encodeURIComponent(origin || '')
  const d = encodeURIComponent(dest || '')
  return `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=transit`
}

// ─── Shared chrome ────────────────────────────────────────────────────────

function PageFrame({ children }) {
  return (
    <div
      data-poster-page="1"
      style={{
        width: PAGE_W,
        height: PAGE_H,
        background: '#fff',
        color: INK,
        fontFamily: theme.font.sans,
        position: 'relative',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* Twin accent strip top */}
      <div style={{ height: 6, background: ORANGE }} />
      <div style={{ height: 8, background: NAVY }} />
      {children}
      {/* Navy footer band */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          background: NAVY,
          color: CREAM,
          padding: '10px 0',
          fontSize: 11,
          textAlign: 'center',
          letterSpacing: 0.3,
        }}
      >
        Hommies.sg &nbsp;·&nbsp; Your housemates, your homies &nbsp;·&nbsp; Line: lin.ee/5akebPB
      </div>
    </div>
  )
}

function BrandLogo() {
  return (
    <div
      style={{
        position: 'absolute',
        top: PAGE_PAD_TOP,
        right: PAGE_PAD_X,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: '#fff',
        padding: '6px 12px',
        borderRadius: 8,
      }}
    >
      <img
        src="/apple-touch-icon.png"
        alt=""
        crossOrigin="anonymous"
        style={{ width: 26, height: 26 }}
      />
      <div style={{ fontFamily: theme.font.sans, fontWeight: 700, fontSize: 14, color: INK }}>
        hommies.<span style={{ color: NAVY }}>SG</span>
      </div>
    </div>
  )
}

function SectionTitle({ children }) {
  return (
    <h2
      style={{
        margin: '24px 0 10px',
        fontSize: 18,
        fontWeight: 500,
        color: ORANGE,
        letterSpacing: 0,
      }}
    >
      {children}
    </h2>
  )
}

// ─── Page 1: hero, photos, floorplan ──────────────────────────────────────

function PageOne({ property, content }) {
  const order = Array.isArray(content?.photoOrder) && content.photoOrder.length
    ? content.photoOrder
    : (property.images || []).map((_, i) => i)
  const roomShots = order.slice(0, 4)
  const floorplanIdx = content?.floorplanIdx
  const rent = formatRent(property.rentSGD)
  // Prefer the verbatim listing title from the URL extractor; fall back to
  // Gemini's headline or just the condo name.
  const headline = property.listingTitle || content?.headline || property.condo
  const subtitle = content?.subtitle || property.condo
  // Same for availability — listing page is the source of truth.
  const availability = property.availability || content?.availability

  return (
    <PageFrame>
      <BrandLogo />
      <div style={{ padding: `${PAGE_PAD_TOP + 70}px ${PAGE_PAD_X}px 0` }}>
        <h1
          style={{
            margin: 0,
            fontSize: 32,
            lineHeight: 1.15,
            fontWeight: 600,
            color: NAVY,
            letterSpacing: -0.3,
          }}
        >
          {headline}
        </h1>
        <div style={{ marginTop: 6, fontSize: 15, color: INK_SOFT }}>{subtitle}</div>

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 16 }}>
          {rent && (
            <div>
              <span style={{ fontSize: 26, fontWeight: 600, color: ORANGE }}>{rent}</span>
              <span style={{ fontSize: 13, color: INK_SOFT, marginLeft: 4 }}>/ month</span>
            </div>
          )}
          {availability && (
            <div style={{ fontSize: 12, color: INK }}>
              Available from {availability}
            </div>
          )}
        </div>

        {property.listingUrl && (
          <div
            style={{
              marginTop: 6,
              fontSize: 10,
              color: INK_SOFT,
              wordBreak: 'break-all',
            }}
          >
            Listing:{' '}
            <a href={property.listingUrl} style={{ color: ORANGE, textDecoration: 'none' }}>
              {property.listingUrl}
            </a>
          </div>
        )}

        <div style={{ marginTop: 14, height: 2, background: ORANGE, borderRadius: 2 }} />

        {/* 2×2 photo grid */}
        <div
          style={{
            marginTop: 18,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
          }}
        >
          {roomShots.map((idx) => (
            <div
              key={idx}
              style={{
                height: 200,
                borderRadius: 6,
                overflow: 'hidden',
                background: theme.color.greySoft,
              }}
            >
              <img
                src={imgUrl(property, idx)}
                alt=""
                crossOrigin="anonymous"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </div>
          ))}
        </div>

        {floorplanIdx != null && (
          <>
            <SectionTitle>Room Layout</SectionTitle>
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                marginTop: 4,
              }}
            >
              <img
                src={imgUrl(property, floorplanIdx)}
                alt=""
                crossOrigin="anonymous"
                style={{ maxHeight: 280, maxWidth: '70%', display: 'block' }}
              />
            </div>
          </>
        )}

        <SectionTitle>Room Details</SectionTitle>
      </div>
    </PageFrame>
  )
}

// ─── Page 2: details table, commute, facilities ───────────────────────────

function DetailsTable({ rows }) {
  return (
    <div style={{ marginTop: 4 }}>
      {rows.map((row, i) => (
        <div
          key={row.label}
          style={{
            display: 'grid',
            gridTemplateColumns: '160px 1fr',
            gap: 16,
            padding: '12px 0',
            borderTop: `1px solid ${HAIRLINE}`,
            borderBottom: i === rows.length - 1 ? `1px solid ${HAIRLINE}` : 'none',
            fontSize: 12,
            color: INK,
          }}
        >
          <div style={{ color: INK_SOFT }}>{row.label}</div>
          <div>{row.value}</div>
        </div>
      ))}
    </div>
  )
}

function CommuteTable({ property, content, primaryUni }) {
  const dest = {
    NUS: 'Kent Ridge MRT, Singapore',
    NTU: 'Nanyang Technological University, Singapore',
    SMU: 'Singapore Management University',
  }
  const cm = content?.commute || {}
  const origin = property.fullAddress || property.condo

  const rows = ['NUS', 'NTU', 'SMU'].map((uni) => {
    const data = cm[uni] || {}
    const isPrimary = primaryUni === uni
    return {
      uni,
      isPrimary,
      route: data.route || '—',
      total: data.total || data.minutes ? `~${data.minutes || data.total} min` : '—',
      url: mapsDirUrl(origin, dest[uni]),
    }
  })

  return (
    <div style={{ marginTop: 6, fontSize: 12 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '90px 1fr 80px 80px',
          gap: 12,
          padding: '8px 10px',
          background: theme.color.greySoft,
          color: INK_SOFT,
          fontWeight: 500,
        }}
      >
        <div>University</div>
        <div>Route</div>
        <div>Total</div>
        <div>Map</div>
      </div>
      {rows.map((r) => (
        <div
          key={r.uni}
          style={{
            display: 'grid',
            gridTemplateColumns: '90px 1fr 80px 80px',
            gap: 12,
            padding: '12px 10px',
            borderBottom: `1px solid ${HAIRLINE}`,
            color: r.isPrimary ? ORANGE : INK,
            fontWeight: r.isPrimary ? 600 : 400,
          }}
        >
          <div>
            {r.isPrimary && <span style={{ marginRight: 4 }}>★</span>}
            {r.uni}
          </div>
          <div>{r.route}</div>
          <div>{r.total}</div>
          <div>
            <a href={r.url} style={{ color: ORANGE, textDecoration: 'underline' }}>
              View →
            </a>
          </div>
        </div>
      ))}
    </div>
  )
}

function hasFacilities(sections) {
  const s = sections || {}
  return (
    (s.inCondo?.length || 0) +
      (s.food?.length || 0) +
      (s.supermarkets?.length || 0) +
      (s.malls?.length || 0) >
    0
  )
}

function FacilitiesBox({ sections }) {
  const left = sections?.inCondo || []
  const food = sections?.food || []
  const supermarkets = sections?.supermarkets || []
  const malls = sections?.malls || []
  // Hide the whole box (and its section title — controlled in PageTwo) if
  // none of the four lists got any items from extraction.
  if (left.length + food.length + supermarkets.length + malls.length === 0) return null
  return (
    <div
      style={{
        background: CREAM,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 6,
        padding: '16px 18px',
        marginTop: 8,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 24,
        fontSize: 11,
        lineHeight: 1.55,
        color: INK,
      }}
    >
      <div>
        {left.length > 0 && (
          <>
            <div style={{ fontWeight: 600, color: ORANGE, marginBottom: 6 }}>In the condo</div>
            {left.map((l, i) => <div key={i}>• {l}</div>)}
          </>
        )}
      </div>
      <div>
        {food.length > 0 && (
          <>
            <div style={{ fontWeight: 600, color: ORANGE, marginBottom: 6 }}>Food</div>
            {food.map((l, i) => <div key={i}>• {l}</div>)}
          </>
        )}
        {supermarkets.length > 0 && (
          <>
            <div style={{ fontWeight: 600, color: ORANGE, margin: '12px 0 6px' }}>Supermarkets</div>
            {supermarkets.map((l, i) => <div key={i}>• {l}</div>)}
          </>
        )}
        {malls.length > 0 && (
          <>
            <div style={{ fontWeight: 600, color: ORANGE, margin: '12px 0 6px' }}>Malls</div>
            {malls.map((l, i) => <div key={i}>• {l}</div>)}
          </>
        )}
      </div>
    </div>
  )
}

function PageTwo({ property, content, primaryUni }) {
  // Prefer verified extractor values over Gemini-derived ones. Gemini only
  // gets the say on housemates + house rules (those require photo inference).
  const sizeText =
    typeof property.sizeSqft === 'number' ? `${property.sizeSqft} sqft` : content?.size
  const furnishingText = property.furnishing || content?.furnishing
  const detailRows = [
    property.unitType ? { label: 'Room type', value: property.unitType } : null,
    sizeText ? { label: 'Size', value: sizeText } : null,
    furnishingText ? { label: 'Furnishing', value: furnishingText } : null,
    content?.housemates ? { label: 'Housemates', value: content.housemates } : null,
    content?.houseRules ? { label: 'House rules', value: content.houseRules } : null,
  ].filter(Boolean)

  return (
    <PageFrame>
      <BrandLogo />
      <div style={{ padding: `${PAGE_PAD_TOP + 70}px ${PAGE_PAD_X}px ${PAGE_PAD_BOTTOM + 30}px` }}>
        {detailRows.length > 0 && <DetailsTable rows={detailRows} />}

        <SectionTitle>Commute to Your Campus</SectionTitle>
        <div style={{ fontSize: 11, color: INK_SOFT, marginTop: -4 }}>
          Tap any row to open live Google Maps directions
        </div>
        <CommuteTable property={property} content={content} primaryUni={primaryUni} />

        {hasFacilities(content?.sections) && (
          <>
            <SectionTitle>Condo Facilities &amp; Nearby</SectionTitle>
            <FacilitiesBox sections={content?.sections} />
          </>
        )}
      </div>
    </PageFrame>
  )
}

// ─── Page 3: transport + closing ──────────────────────────────────────────

// True when page 3 has anything worth rendering. If false, the page is
// omitted entirely so the operator never sees a near-blank page.
function pageThreeHasContent(content) {
  const mrt = content?.mrt || []
  const bus = content?.bus || []
  return mrt.length > 0 || bus.length > 0
}

function PageThree({ property, content }) {
  const mrt = content?.mrt || []
  const bus = content?.bus || []
  const closing =
    content?.closing ||
    "If this one feels right, let's hop on a quick Zoom and we'll walk you through everything — the unit, housemates, and move-in. Reply on Line and we'll take it from there."

  return (
    <PageFrame>
      <BrandLogo />
      <div style={{ padding: `${PAGE_PAD_TOP + 70}px ${PAGE_PAD_X}px ${PAGE_PAD_BOTTOM + 30}px` }}>
        <SectionTitle>Nearby Transport</SectionTitle>
        <div
          style={{
            background: CREAM,
            border: `1px solid ${HAIRLINE}`,
            borderRadius: 6,
            padding: '16px 18px',
            marginTop: 6,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 24,
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, color: NAVY, marginBottom: 6 }}>MRT</div>
            {mrt.length === 0 && <div style={{ color: INK_SOFT }}>—</div>}
            {mrt.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: mrtColor(m.code),
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: NAVY, fontWeight: 500 }}>{m.code}</span>
                <span>{m.name}{m.walkMin ? `  (${m.walkMin} min walk)` : ''}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontWeight: 600, color: NAVY, marginBottom: 6 }}>Bus</div>
            {bus.length === 0 && <div style={{ color: INK_SOFT }}>—</div>}
            {bus.map((b, i) => (
              <div key={i}>Bus {b.number} — {b.route}</div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 32, fontSize: 12, color: INK, lineHeight: 1.6 }}>
          {closing}
        </div>
      </div>
    </PageFrame>
  )
}

// ─── Top-level ───────────────────────────────────────────────────────────

export default function Poster({ property, content, primaryUni = 'NUS' }) {
  const showPageThree = pageThreeHasContent(content)
  return (
    <div>
      <PageOne property={property} content={content} />
      <PageTwo property={property} content={content} primaryUni={primaryUni} />
      {showPageThree && <PageThree property={property} content={content} />}
    </div>
  )
}

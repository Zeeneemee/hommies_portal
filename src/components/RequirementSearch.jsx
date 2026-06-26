import React from 'react'
import { useAction } from 'convex/react'
import { Icon, Pill } from './ui.jsx'

// Screen: enter a customer name + their requirement → search PropertyGuru for
// matching listing links (top 10, via Firecrawl) → tick the ones you want to
// send. Pushing the selection to the Google Sheet is intentionally deferred for
// now (the "choose" set is kept client-side only).

const money = (b) =>
  b && b.max < 99999 ? `$${b.min || 0}–$${b.max}` : b?.min ? `from $${b.min}` : '—'

export default function RequirementSearch({ toast }) {
  const search = useAction('pgSearch:searchListings')

  const [name, setName] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [result, setResult] = React.useState(null) // { ok, note, query, parsed, candidates }
  const [error, setError] = React.useState('')
  const [chosen, setChosen] = React.useState({}) // url -> candidate

  const runSearch = async () => {
    const text = message.trim()
    if (!name.trim()) {
      setError('Enter the customer name first.')
      return
    }
    if (!text) {
      setError('Enter the requirement first.')
      return
    }
    setError('')
    setResult(null)
    setChosen({})
    setLoading(true)
    try {
      const r = await search({ message: text, name: name.trim() })
      setResult(r)
      if (!r.ok) setError(r.note)
    } catch (e) {
      setError(e?.message || 'Search failed.')
    } finally {
      setLoading(false)
    }
  }

  const toggleChoose = (candidate) => {
    setChosen((c) => {
      const next = { ...c }
      if (next[candidate.url]) delete next[candidate.url]
      else next[candidate.url] = candidate
      return next
    })
  }

  const p = result?.parsed
  const chosenList = Object.values(chosen)

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Find &amp; send a listing</h1>
          <p className="page-sub">
            Enter the customer and their requirement, search PropertyGuru for matching listing
            links, then tick the ones you want to send. (Pushing to the sheet is coming next.)
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-pad">
          <label className="field-label" htmlFor="cust-name">
            1 · Customer name
          </label>
          <input
            id="cust-name"
            className="input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alex Tan"
          />

          <label className="field-label" htmlFor="req-msg" style={{ marginTop: 14 }}>
            2 · Requirement
          </label>
          <textarea
            id="req-msg"
            className="textarea"
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Looking for a common room near NUS, budget ~$2,500, condo, move in immediately."
          />
          <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={runSearch}
              disabled={loading}
            >
              {loading ? 'Searching…' : '3 · Search PropertyGuru'}
            </button>
            {error && <span className="muted" style={{ color: 'var(--danger, #c0392b)' }}>{error}</span>}
          </div>
        </div>
      </div>

      {p && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <div className="card-title">Parsed customer</div>
            <div className="card-sub">What we understood from the requirement.</div>
          </div>
          <div className="card-pad" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Pill kind="grey">{p.name || 'No name'}</Pill>
            <Pill kind="grey">{p.contact || 'No contact'}</Pill>
            <Pill kind="grey">{p.school}</Pill>
            <Pill kind="grey">{p.buildingType}</Pill>
            <Pill kind="grey">{p.unitLayout?.length ? p.unitLayout.join(', ') : p.housingType}</Pill>
            {p.bedrooms ? (
              <Pill kind="grey">
                {p.bedrooms}B{p.bathrooms ? `${p.bathrooms}B` : ''}
              </Pill>
            ) : null}
            <Pill kind="grey">{money(p.budget)}</Pill>
            {p.moveIn && <Pill kind="grey">Move-in: {p.moveIn}</Pill>}
          </div>
          {result.query && (
            <div className="card-pad" style={{ paddingTop: 0 }}>
              <span className="muted">Query: {result.query}</span>
            </div>
          )}
        </div>
      )}

      {result?.ok && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <div className="card-title">4 · Choose listings</div>
            <div className="card-sub">
              {result.candidates.length
                ? `${result.candidates.length} link(s) found · ${chosenList.length} chosen`
                : 'No matching listings'}
            </div>
          </div>
          <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {result.candidates.length === 0 && (
              <span className="muted">{result.note}</span>
            )}
            {result.candidates.map((c) => {
              const picked = !!chosen[c.url]
              return (
                <div
                  key={c.url}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    borderBottom: '1px solid var(--line, #eee)',
                    paddingBottom: 10,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <a href={c.url} target="_blank" rel="noreferrer" className="card-title" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      {c.title || c.url} <Icon name="external" size={13} />
                    </a>
                    {c.snippet && (
                      <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                        {c.snippet.slice(0, 160)}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className={picked ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                    onClick={() => toggleChoose(c)}
                  >
                    {picked ? 'Chosen ✓' : 'Choose'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {chosenList.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <div className="card-title">5 · Selected for {p?.name || 'customer'}</div>
            <div className="card-sub">{chosenList.length} listing(s) ready to send.</div>
          </div>
          <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {chosenList.map((c) => (
              <a
                key={c.url}
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className="muted"
                style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}
              >
                {c.title || c.url} <Icon name="external" size={12} />
              </a>
            ))}
          </div>
          <div className="card-pad" style={{ paddingTop: 0, display: 'flex', gap: 10, alignItems: 'center' }}>
            <button type="button" className="btn btn-primary" disabled title="Sheet sync coming next">
              Push to sheet (coming soon)
            </button>
            <span className="muted">Sheet sync is deferred for now.</span>
          </div>
        </div>
      )}
    </>
  )
}

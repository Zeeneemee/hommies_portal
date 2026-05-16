import React from 'react'
import { useMutation } from 'convex/react'
import { recommendRecipients, draftMessage, parseGoogleFormCSV } from '../decisionLogic.js'
import { Icon, Pill, StatusPill } from './ui.jsx'
import ManualResponseModal from './ManualResponseModal.jsx'

// Screen 3 — the decision engine. Pick a property; every form response gets a
// binary verdict — send or hold — with a plain-language reason and pass/soft/
// fail criteria chips. Send entries reveal a bilingual outreach draft.
// A property is "matchable" — eligible for the picker — only when the fields
// the decision engine reads have been lifted from its poster.
function isMatchable(p) {
  return (
    typeof p.rentSGD === 'number' &&
    !!p.housingType &&
    !!p.commuteMins &&
    typeof p.commuteMins.NUS === 'number'
  )
}

export default function RecommendScreen({ toast, properties, responses }) {
  const addResponse = useMutation('responses:add')
  const addManyResponses = useMutation('responses:addMany')

  const matchable = React.useMemo(() => properties.filter(isMatchable), [properties])
  const hiddenCount = properties.length - matchable.length

  const [selectedId, setSelectedId] = React.useState(matchable[0]?._id || null)
  const [bucket, setBucket] = React.useState('send')
  const [expanded, setExpanded] = React.useState({})
  const [showManual, setShowManual] = React.useState(false)
  const csvRef = React.useRef(null)

  // Keep selectedId valid as the matchable list changes (extraction landing,
  // properties added/removed).
  React.useEffect(() => {
    if (selectedId && !matchable.find((p) => p._id === selectedId)) {
      setSelectedId(matchable[0]?._id || null)
    } else if (!selectedId && matchable[0]) {
      setSelectedId(matchable[0]._id)
    }
  }, [matchable, selectedId])

  const prop = matchable.find((p) => p._id === selectedId) || null
  const result = React.useMemo(
    () => (prop ? recommendRecipients(prop, responses) : { send: [], hold: [] }),
    [prop, responses],
  )

  async function handleCSV(file) {
    if (!file) return
    try {
      const text = await file.text()
      const rows = parseGoogleFormCSV(text)
      if (rows.length === 0) {
        toast('No rows parsed from that CSV.')
        return
      }
      await addManyResponses({ responses: rows })
      toast(`Loaded ${rows.length} form response${rows.length === 1 ? '' : 's'}.`)
    } catch {
      toast('Could not parse that CSV.')
    } finally {
      if (csvRef.current) csvRef.current.value = ''
    }
  }

  if (properties.length === 0) {
    return (
      <div>
        <div className="page-header">
          <div>
            <div className="eyebrow">Step 3 · Match</div>
            <h1 className="page-title">Recommend</h1>
          </div>
        </div>
        <div className="empty">
          <h4>No properties yet</h4>
          <p>Add one first, then come back to match.</p>
        </div>
      </div>
    )
  }

  if (matchable.length === 0) {
    return (
      <div>
        <div className="page-header">
          <div>
            <div className="eyebrow">Step 3 · Match</div>
            <h1 className="page-title">Recommend</h1>
          </div>
        </div>
        <div className="empty">
          <h4>Waiting on poster extraction</h4>
          <p>
            None of your {properties.length} propert{properties.length === 1 ? 'y has' : 'ies have'} a lifted rent /
            housing type / commute yet. Attach the <code>/room-showcase-pdf</code> poster on a property and it'll
            appear here once extraction lands.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Step 3 · Match</div>
          <h1 className="page-title">Recommend</h1>
          <p className="page-sub">
            Pick a property. Every form response gets a binary verdict — send or hold — with the reason in plain words.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            ref={csvRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => handleCSV(e.target.files?.[0])}
          />
          <button className="btn btn-ghost" onClick={() => csvRef.current?.click()}>
            <Icon name="upload" size={14} /> Import form CSV
          </button>
          <button className="btn btn-nav-secondary" onClick={() => setShowManual(true)}>
            <Icon name="plus" size={14} /> Add response
          </button>
        </div>
      </div>

      <div className="recommend-grid">
        {/* LEFT — property picker */}
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">Choose property</h3>
            <p className="card-sub">
              {properties.length} in inventory · {responses.length} form responses on file
            </p>
          </div>
          <div className="card-pad" style={{ paddingTop: 14 }}>
            <div className="property-picker-list">
              {matchable.map((p) => (
                <button
                  key={p._id}
                  type="button"
                  className={`property-pick ${selectedId === p._id ? 'on' : ''}`}
                  onClick={() => setSelectedId(p._id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <span className="pp-name">{p.condo}</span>
                    <StatusPill status={p.status} />
                  </div>
                  <span className="pp-meta">
                    {p.unitType} · {p.area} · S${p.rentSGD}/mo
                  </span>
                </button>
              ))}
            </div>
            {hiddenCount > 0 && (
              <div className="recommend-hidden-note">
                {hiddenCount} propert{hiddenCount === 1 ? 'y is' : 'ies are'} hidden — waiting on poster extraction to
                lift rent / housing / commute.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — results */}
        <div>
          <div className="principle">
            <Icon name="sparkle" size={18} stroke={1.8} style={{ color: 'var(--orange)', marginTop: 2 }} />
            <div>
              <div className="quote">"We do not blast. A poor match sent today costs a good match's trust tomorrow."</div>
              <div className="sub">
                Held-back recipients are deliberate. They'll get a different property — not this one.
              </div>
            </div>
          </div>

          {prop && (
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="card-pad" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 14 }}>
                <div>
                  <div className="fact-label">Matching against</div>
                  <div className="fact-val" style={{ fontSize: 16 }}>
                    {prop.condo}
                  </div>
                </div>
                <div>
                  <div className="fact-label">Rent</div>
                  <div className="fact-val">S${prop.rentSGD}/mo</div>
                </div>
                <div>
                  <div className="fact-label">Commute</div>
                  <div className="fact-val" style={{ fontSize: 13 }}>
                    NUS {prop.commuteMins.NUS}m · NTU {prop.commuteMins.NTU}m · SMU {prop.commuteMins.SMU}m
                  </div>
                </div>
                <div>
                  <div className="fact-label">Layout</div>
                  <div className="fact-val">
                    {prop.unitType} · {prop.housingType}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bucket-tabs">
            <button className={`bucket-tab ${bucket === 'send' ? 'on' : ''}`} onClick={() => setBucket('send')}>
              <Icon name="send" size={14} /> Send <span className="count">{result.send.length}</span>
            </button>
            <button className={`bucket-tab ${bucket === 'hold' ? 'on' : ''}`} onClick={() => setBucket('hold')}>
              <Icon name="x" size={14} /> Don't send <span className="count">{result.hold.length}</span>
            </button>
          </div>

          {bucket === 'send' && result.send.length === 0 && (
            <div className="empty">
              <h4>Nothing to send for this property</h4>
              <p>The held-back tab will tell you why.</p>
            </div>
          )}
          {bucket === 'hold' && result.hold.length === 0 && (
            <div className="empty">
              <h4>No one held back</h4>
              <p>Every form response is a fit.</p>
            </div>
          )}

          {bucket === 'send' &&
            result.send.map((d, idx) => (
              <MatchCard
                key={d.response._id ?? d.response.name + idx}
                rank={idx + 1}
                verdict="send"
                response={d.response}
                decision={d.decision}
                property={prop}
                isOpen={!!expanded[d.response._id ?? idx]}
                onToggle={() =>
                  setExpanded((e) => ({
                    ...e,
                    [d.response._id ?? idx]: !e[d.response._id ?? idx],
                  }))
                }
                toast={toast}
              />
            ))}

          {bucket === 'hold' &&
            result.hold.map((d, idx) => (
              <MatchCard
                key={d.response._id ?? d.response.name + idx}
                verdict="hold"
                response={d.response}
                decision={d.decision}
                property={prop}
                isOpen={false}
                onToggle={() => {}}
                toast={toast}
              />
            ))}
        </div>
      </div>

      {showManual && (
        <ManualResponseModal
          onClose={() => setShowManual(false)}
          onSave={async (r) => {
            await addResponse(r)
            toast(`${r.name} added.`)
            setShowManual(false)
          }}
        />
      )}
    </div>
  )
}

function MatchCard({ rank, verdict, response, decision, property, isOpen, onToggle, toast }) {
  const isSend = verdict === 'send'
  const draft = React.useMemo(
    () => draftMessage(response, property, decision),
    [response, property, decision],
  )

  const copy = () => {
    navigator.clipboard?.writeText(draft)
    toast?.('Draft copied — paste into Line/IG.')
  }

  return (
    <div className="match-card">
      <div className="match-rank">
        {isSend ? (
          <>
            #{rank}
            <span className="small">Rank</span>
          </>
        ) : (
          <>
            <Icon name="x" size={20} />
            <span className="small">Hold</span>
          </>
        )}
      </div>
      <div className="match-body">
        <div className="top">
          <span className="name">{response.name}</span>
          <span className="meta">
            · {response.school} · {response.channel}
            {response.contact && ` · ${response.contact}`}
          </span>
        </div>
        <div className="meta">
          Budget S${response.budget.min}–{response.budget.max} · Move-in {response.moveIn || '—'} · Commute tol.{' '}
          {response.commuteTolMins}min
        </div>
        <div className="reason" style={{ color: isSend ? 'var(--ink)' : 'var(--danger)' }}>
          {isSend ? (
            <Pill kind="green" dot>
              Send
            </Pill>
          ) : (
            <Pill kind="danger" dot>
              Hold
            </Pill>
          )}
          <span style={{ marginLeft: 8 }}>{decision.reason}</span>
        </div>
        <div className="match-criteria">
          {decision.criteria.map((c, i) => (
            <span key={i} className={`crit ${c.level}`} title={c.detail}>
              <i className="icon" />
              {c.label}
            </span>
          ))}
        </div>

        {isOpen && (
          <div className="draft">
            <div className="draft-head">
              <span className="t">Draft for {response.channel} · bilingual</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={copy}>
                  <Icon name="copy" size={12} /> Copy
                </button>
                <button className="btn btn-ghost btn-sm" onClick={onToggle}>
                  Close
                </button>
              </div>
            </div>
            <div className="draft-body">{draft}</div>
          </div>
        )}
      </div>
      <div className="match-actions">
        {isSend ? (
          <>
            <div className="match-score">
              {decision.score}
              <span className="total">/100</span>
            </div>
            <button className="btn btn-primary btn-sm" onClick={onToggle}>
              <Icon name="mail" size={12} /> {isOpen ? 'Hide' : 'Draft message'}
            </button>
          </>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--ink-mute)', textAlign: 'right', maxWidth: 140 }}>
            Score {decision.score}/100
            <br />
            Held back, not blasted.
          </div>
        )}
      </div>
    </div>
  )
}

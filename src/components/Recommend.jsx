import React from 'react'
import { useMutation } from 'convex/react'
import {
  recommendRecipients,
  draftMessage,
  parseGoogleFormCSV,
  decide,
} from '../decisionLogic.js'
import { Icon, Pill, StatusPill } from './ui.jsx'
import ManualResponseModal from './ManualResponseModal.jsx'

// Screen 3 — the decision engine. Two complementary views over the same
// matching logic:
//
//   • By property — pick a listing, see ranked Send / Hold customers
//                   (the original workflow)
//   • By client   — pick a customer, see ranked Send / Hold properties
//                   ("what should I send this person?")
//
// Same engine, mirrored direction. Drafts and reasons are identical in
// either view — the only thing that changes is which list you iterate.

function propertyIsMatchable(p) {
  return (
    typeof p.rentSGD === 'number' &&
    !!p.housingType &&
    !!p.commuteMins &&
    typeof p.commuteMins.NUS === 'number'
  )
}

// Mirror of recommendRecipients — for one client, score every matchable
// property and split into Send / Hold buckets. Pre-extraction properties
// land in Hold with a "waiting on extraction" reason so the operator sees
// the inventory at all times.
function recommendListingsForClient(client, properties) {
  const send = []
  const hold = []
  for (const property of properties || []) {
    if (!propertyIsMatchable(property)) {
      hold.push({
        property,
        decision: {
          verdict: 'hold',
          score: 0,
          reason: 'Waiting on poster extraction (no rent / housing / commute yet).',
          criteria: [],
          blockers: ['unextracted'],
        },
      })
      continue
    }
    const decision = decide(client, property)
    const entry = { property, decision }
    if (decision.verdict === 'send') send.push(entry)
    else hold.push(entry)
  }
  send.sort((a, b) => b.decision.score - a.decision.score)
  hold.sort((a, b) => b.decision.score - a.decision.score)
  return { send, hold }
}

export default function RecommendScreen({ toast, properties, responses }) {
  const addResponse = useMutation('responses:add')
  const addManyResponses = useMutation('responses:addMany')

  const [viewMode, setViewMode] = React.useState('by-property')
  const [showManual, setShowManual] = React.useState(false)
  const csvRef = React.useRef(null)

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

  // Quick guards for the two empty cases.
  if (properties.length === 0 && responses.length === 0) {
    return (
      <div>
        <Header viewMode={viewMode} onViewMode={setViewMode} hideToggle />
        <div className="empty">
          <h4>Nothing to match yet</h4>
          <p>Add a property and a customer, then come back.</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header
        viewMode={viewMode}
        onViewMode={setViewMode}
        actions={
          <>
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
          </>
        }
      />

      {viewMode === 'by-property' ? (
        <ByPropertyView properties={properties} responses={responses} toast={toast} />
      ) : (
        <ByClientView properties={properties} responses={responses} toast={toast} />
      )}

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

function Header({ viewMode, onViewMode, hideToggle, actions }) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">Step 3 · Match</div>
        <h1 className="page-title">Recommend</h1>
        <p className="page-sub">
          Two ways to look at the same matches — pick a property to see who to send it to, or pick a customer to see
          which listings fit them.
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
        {!hideToggle && (
          <div className="view-toggle" role="tablist" aria-label="Recommend view">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'by-property'}
              className={viewMode === 'by-property' ? 'on' : ''}
              onClick={() => onViewMode('by-property')}
            >
              <Icon name="grid" size={12} /> By property
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'by-client'}
              className={viewMode === 'by-client' ? 'on' : ''}
              onClick={() => onViewMode('by-client')}
            >
              <Icon name="user" size={12} /> By client
            </button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>{actions}</div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEW 1 — By property (pick a listing, see Send / Hold customers)
// ─────────────────────────────────────────────────────────────────────────────
function ByPropertyView({ properties, responses, toast }) {
  const matchable = React.useMemo(() => properties.filter(propertyIsMatchable), [properties])
  const hiddenCount = properties.length - matchable.length

  const [selectedId, setSelectedId] = React.useState(matchable[0]?._id || null)
  const [bucket, setBucket] = React.useState('send')
  const [expanded, setExpanded] = React.useState({})

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

  if (matchable.length === 0) {
    return (
      <div className="empty">
        <h4>Waiting on poster extraction</h4>
        <p>
          None of your {properties.length} propert{properties.length === 1 ? 'y has' : 'ies have'} a lifted rent /
          housing type / commute yet. Attach the <code>/room-showcase-pdf</code> poster on a property and it'll
          appear here once extraction lands.
        </p>
      </div>
    )
  }

  return (
    <div className="recommend-grid">
      <div className="card">
        <div className="card-head">
          <h3 className="card-title">Choose property</h3>
          <p className="card-sub">
            {matchable.length} matchable · {responses.length} customer{responses.length === 1 ? '' : 's'} on file
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

      <div>
        <PrincipleQuote />

        {prop && (
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-pad recommend-fact-row">
              <Fact label="Matching against" value={prop.condo} big />
              <Fact label="Rent" value={`S$${prop.rentSGD}/mo`} />
              <Fact
                label="Commute"
                value={`NUS ${prop.commuteMins.NUS}m · NTU ${prop.commuteMins.NTU}m · SMU ${prop.commuteMins.SMU}m`}
                small
              />
              <Fact label="Layout" value={`${prop.unitType} · ${prop.housingType}`} />
            </div>
          </div>
        )}

        <BucketTabs
          bucket={bucket}
          onBucket={setBucket}
          sendCount={result.send.length}
          holdCount={result.hold.length}
        />

        {bucket === 'send' && result.send.length === 0 && (
          <div className="empty">
            <h4>Nothing to send for this property</h4>
            <p>The held-back tab will tell you why.</p>
          </div>
        )}
        {bucket === 'hold' && result.hold.length === 0 && (
          <div className="empty">
            <h4>No one held back</h4>
            <p>Every customer is a fit.</p>
          </div>
        )}

        {bucket === 'send' &&
          result.send.map((d, idx) => (
            <ClientMatchCard
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
            <ClientMatchCard
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
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEW 2 — By client (pick a customer, see Send / Hold properties)
// ─────────────────────────────────────────────────────────────────────────────
const SCHOOL_FILTERS = ['All', 'NUS', 'NTU', 'SMU', 'OTHER']

function ByClientView({ properties, responses, toast }) {
  const [school, setSchool] = React.useState('All')
  const [search, setSearch] = React.useState('')
  const [selectedId, setSelectedId] = React.useState(responses[0]?._id || null)
  const [bucket, setBucket] = React.useState('send')
  const [expanded, setExpanded] = React.useState({})

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return responses.filter((r) => {
      if (school !== 'All' && r.school !== school) return false
      if (q && !`${r.name} ${r.contact}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [responses, school, search])

  React.useEffect(() => {
    if (selectedId && !filtered.find((r) => r._id === selectedId)) {
      setSelectedId(filtered[0]?._id || null)
    } else if (!selectedId && filtered[0]) {
      setSelectedId(filtered[0]._id)
    }
  }, [filtered, selectedId])

  const client = filtered.find((r) => r._id === selectedId) || null
  const result = React.useMemo(
    () => (client ? recommendListingsForClient(client, properties) : { send: [], hold: [] }),
    [client, properties],
  )

  if (responses.length === 0) {
    return (
      <div className="empty">
        <h4>No customers yet</h4>
        <p>
          Import a Google Form CSV (top right) or add a walk-in via the manual form — then pick the customer here
          to see which listings fit them.
        </p>
      </div>
    )
  }

  return (
    <div className="recommend-grid">
      <div className="card">
        <div className="card-head">
          <h3 className="card-title">Choose customer</h3>
          <p className="card-sub">
            {filtered.length} of {responses.length} shown · {properties.length} propert
            {properties.length === 1 ? 'y' : 'ies'} in inventory
          </p>
        </div>
        <div className="card-pad" style={{ paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="filter-chips">
            {SCHOOL_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                className={`filter-chip ${school === s ? 'on' : ''}`}
                onClick={() => setSchool(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <input
            className="input"
            placeholder="Search name or contact…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="property-picker-list">
            {filtered.length === 0 ? (
              <div className="muted" style={{ padding: 14, fontSize: 13 }}>
                No customers match this filter.
              </div>
            ) : (
              filtered.map((r) => (
                <button
                  key={r._id}
                  type="button"
                  className={`property-pick ${selectedId === r._id ? 'on' : ''}`}
                  onClick={() => setSelectedId(r._id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <span className="pp-name">{r.name}</span>
                    <Pill kind={r.school === 'NUS' ? 'orange' : r.school === 'OTHER' ? 'grey' : 'navy'}>
                      {r.school}
                    </Pill>
                  </div>
                  <span className="pp-meta">
                    {r.housingType} · S${r.budget?.min}–{r.budget?.max} · ≤{r.commuteTolMins}min
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      <div>
        <PrincipleQuote
          extra="In this view, every property a customer would NOT receive is honest — they'll get a different one when it lands."
        />

        {client && (
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-pad recommend-fact-row">
              <Fact label="Matching for" value={client.name} big />
              <Fact label="School" value={client.school} />
              <Fact label="Budget" value={`S$${client.budget?.min}–${client.budget?.max}/mo`} />
              <Fact
                label="Wants"
                value={`${client.housingType}${client.unitLayout?.length ? ` · ${client.unitLayout.join(', ')}` : ''}`}
                small
              />
            </div>
          </div>
        )}

        <BucketTabs
          bucket={bucket}
          onBucket={setBucket}
          sendCount={result.send.length}
          holdCount={result.hold.length}
          sendLabel="Send these"
          holdLabel="Don't send"
        />

        {bucket === 'send' && result.send.length === 0 && (
          <div className="empty">
            <h4>No fitting properties for this customer right now</h4>
            <p>The held-back tab shows why each listing was passed over.</p>
          </div>
        )}
        {bucket === 'hold' && result.hold.length === 0 && (
          <div className="empty">
            <h4>Every property fits this customer</h4>
            <p>Lucky one.</p>
          </div>
        )}

        {bucket === 'send' &&
          result.send.map((d, idx) => (
            <PropertyMatchCard
              key={d.property._id}
              rank={idx + 1}
              verdict="send"
              property={d.property}
              decision={d.decision}
              client={client}
              isOpen={!!expanded[d.property._id]}
              onToggle={() =>
                setExpanded((e) => ({ ...e, [d.property._id]: !e[d.property._id] }))
              }
              toast={toast}
            />
          ))}

        {bucket === 'hold' &&
          result.hold.map((d) => (
            <PropertyMatchCard
              key={d.property._id}
              verdict="hold"
              property={d.property}
              decision={d.decision}
              client={client}
              isOpen={false}
              onToggle={() => {}}
              toast={toast}
            />
          ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────────────

function PrincipleQuote({ extra }) {
  return (
    <div className="principle">
      <Icon name="sparkle" size={18} stroke={1.8} style={{ color: 'var(--orange)', marginTop: 2 }} />
      <div>
        <div className="quote">"We do not blast. A poor match sent today costs a good match's trust tomorrow."</div>
        <div className="sub">
          {extra || 'Held-back recipients are deliberate. They’ll get a different property — not this one.'}
        </div>
      </div>
    </div>
  )
}

function Fact({ label, value, big, small }) {
  return (
    <div>
      <div className="fact-label">{label}</div>
      <div className="fact-val" style={big ? { fontSize: 16 } : small ? { fontSize: 13 } : undefined}>
        {value}
      </div>
    </div>
  )
}

function BucketTabs({ bucket, onBucket, sendCount, holdCount, sendLabel = 'Send', holdLabel = "Don't send" }) {
  return (
    <div className="bucket-tabs">
      <button className={`bucket-tab ${bucket === 'send' ? 'on' : ''}`} onClick={() => onBucket('send')}>
        <Icon name="send" size={14} /> {sendLabel} <span className="count">{sendCount}</span>
      </button>
      <button className={`bucket-tab ${bucket === 'hold' ? 'on' : ''}`} onClick={() => onBucket('hold')}>
        <Icon name="x" size={14} /> {holdLabel} <span className="count">{holdCount}</span>
      </button>
    </div>
  )
}

function ClientMatchCard({ rank, verdict, response, decision, property, isOpen, onToggle, toast }) {
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
            <Pill kind="green" dot>Send</Pill>
          ) : (
            <Pill kind="danger" dot>Hold</Pill>
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
            <div className="match-score">{decision.score}<span className="total">/100</span></div>
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

function PropertyMatchCard({ rank, verdict, property, decision, client, isOpen, onToggle, toast }) {
  const isSend = verdict === 'send'
  const isUnextracted = decision.blockers.includes('unextracted')
  const draft = React.useMemo(
    () => (client && isSend ? draftMessage(client, property, decision) : ''),
    [client, property, decision, isSend],
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
          <span className="name">{property.condo}</span>
          <span className="meta">
            {property.area ? ` · ${property.area}` : ''}
            {property.unitType ? ` · ${property.unitType}` : ''}
            {typeof property.rentSGD === 'number' ? ` · S$${property.rentSGD}/mo` : ''}
          </span>
        </div>
        <div className="meta">
          {property.buildingType || '—'}
          {property.commuteMins && client?.school && client.school !== 'OTHER'
            ? ` · ${property.commuteMins[client.school] ?? '—'}min to ${client.school}`
            : ''}
          {property.posterStorageId ? ' · poster ready' : ' · no poster yet'}
        </div>
        <div className="reason" style={{ color: isSend ? 'var(--ink)' : 'var(--danger)' }}>
          {isSend ? (
            <Pill kind="green" dot>Send</Pill>
          ) : isUnextracted ? (
            <Pill kind="warn" dot>Pending</Pill>
          ) : (
            <Pill kind="danger" dot>Hold</Pill>
          )}
          <span style={{ marginLeft: 8 }}>{decision.reason}</span>
        </div>
        {decision.criteria.length > 0 && (
          <div className="match-criteria">
            {decision.criteria.map((c, i) => (
              <span key={i} className={`crit ${c.level}`} title={c.detail}>
                <i className="icon" />
                {c.label}
              </span>
            ))}
          </div>
        )}

        {isOpen && (
          <div className="draft">
            <div className="draft-head">
              <span className="t">
                Draft for {client?.channel || 'Line'} · bilingual
              </span>
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
            <div className="match-score">{decision.score}<span className="total">/100</span></div>
            <button className="btn btn-primary btn-sm" onClick={onToggle}>
              <Icon name="mail" size={12} /> {isOpen ? 'Hide' : 'Draft message'}
            </button>
          </>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--ink-mute)', textAlign: 'right', maxWidth: 160 }}>
            {isUnextracted ? 'Awaits extraction' : `Score ${decision.score}/100`}
            <br />
            {isUnextracted ? 'Attach a poster.' : 'Held back, not blasted.'}
          </div>
        )}
      </div>
    </div>
  )
}

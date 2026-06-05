import React from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  recommendRecipients,
  draftMessage,
  parseGoogleFormCSV,
  decide,
  assembleCohort,
  splitRent,
  SPLIT_POLICIES,
} from '../decisionLogic.js'
import {
  partitionAssignmentsForProperty,
  partitionAssignmentsForClient,
  isPairCovered,
} from '../assignmentHelpers.js'
import { Icon, Pill, StatusPill } from './ui.jsx'
import ManualResponseModal from './ManualResponseModal.jsx'

// Screen 3 — the decision engine, layered with the operator's commitment
// ledger. Each view shows four stacked sections:
//
//   • Must send   — active pins, not yet sent (operator's working queue)
//   • Sent        — read-only audit history
//   • Suggestions — current decide() Send-bucket output minus already-covered pairs
//   • Held back   — current decide() Hold-bucket, with a deliberate
//                   [Override and pin] path for the cases the operator knows
//                   beat the score
//
// decide() and draftMessage() are unchanged — the new sections sit on top.

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
  const assignments = useQuery('assignments:list', {}) ?? []
  const deals = useQuery('deals:list') ?? []
  const pin = useMutation('assignments:pin')
  const unpin = useMutation('assignments:unpin')
  const markSent = useMutation('assignments:markSent')

  // Customers whose deal has reached `moved_in` are excluded from every
  // recommendation surface — they already have a room. Earlier-stage deals
  // (loi_sent / loi_signed / ta_issued) stay visible because deals fall
  // through. Existing pinned/sent assignments for moved-in customers still
  // render in Must-send/Sent (audit trail) — only the candidate pool changes.
  const movedInResponseIds = React.useMemo(() => {
    const set = new Set()
    for (const d of deals) {
      if (d.stage === 'moved_in' && d.cancelledAt === undefined) {
        set.add(d.responseId)
      }
    }
    return set
  }, [deals])
  const openResponses = React.useMemo(
    () => responses.filter((r) => !movedInResponseIds.has(r._id)),
    [responses, movedInResponseIds],
  )

  const [viewMode, setViewMode] = React.useState('by-property')
  const [showManual, setShowManual] = React.useState(false)
  const csvRef = React.useRef(null)

  // Listings cards link here with ?property=<id>. We honour it the first
  // time the page loads, then clear the param so subsequent navigation
  // doesn't keep snapping the picker back.
  const location = useLocation()
  const navigate = useNavigate()
  const requestedPropertyId = React.useMemo(() => {
    const params = new URLSearchParams(location.search)
    return params.get('property')
  }, [location.search])
  const [initialPropertyId, setInitialPropertyId] = React.useState(requestedPropertyId)
  React.useEffect(() => {
    if (requestedPropertyId) {
      setViewMode('by-property')
      setInitialPropertyId(requestedPropertyId)
      navigate('/recommend', { replace: true })
    }
  }, [requestedPropertyId, navigate])

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

  const actions = React.useMemo(
    () => ({
      pin: async ({ propertyId, responseId, pinnedScore, pinnedReason }) => {
        await pin({ propertyId, responseId, pinnedScore, pinnedReason })
        toast('Pinned — added to Must-send.')
      },
      unpin: async (assignmentId) => {
        await unpin({ id: assignmentId })
        toast('Unpinned.')
      },
      markSent: async (assignmentId, sentVia) => {
        await markSent({ id: assignmentId, sentVia })
        toast('Marked sent.')
      },
    }),
    [pin, unpin, markSent, toast],
  )

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
        <ByPropertyView
          properties={properties}
          responses={openResponses}
          assignments={assignments}
          actions={actions}
          toast={toast}
          initialPropertyId={initialPropertyId}
        />
      ) : (
        <ByClientView
          properties={properties}
          responses={openResponses}
          assignments={assignments}
          actions={actions}
          toast={toast}
        />
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
// VIEW 1 — By property
// ─────────────────────────────────────────────────────────────────────────────
function ByPropertyView({ properties, responses, assignments, actions, toast, initialPropertyId }) {
  const matchable = React.useMemo(() => properties.filter(propertyIsMatchable), [properties])
  const hiddenCount = properties.length - matchable.length

  const [search, setSearch] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 200)
    return () => clearTimeout(t)
  }, [search])

  const visible = React.useMemo(() => {
    if (!debouncedSearch) return matchable
    return matchable.filter((p) => {
      const hay = [p.condo, p.area, p.unitType, p.rentSGD != null ? String(p.rentSGD) : '']
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(debouncedSearch)
    })
  }, [matchable, debouncedSearch])

  const [selectedId, setSelectedId] = React.useState(
    initialPropertyId && matchable.find((p) => p._id === initialPropertyId)
      ? initialPropertyId
      : matchable[0]?._id || null,
  )
  const [expanded, setExpanded] = React.useState({})
  // Cohort assembly state — one comparison per click holds all three
  // policy results. Cleared when the selected property changes.
  //   { byPolicy: { equal, light, standard }, dismissed: Set<policy> } | null
  const [cohortComparison, setCohortComparison] = React.useState(null)
  React.useEffect(() => { setCohortComparison(null) }, [selectedId])

  React.useEffect(() => {
    if (initialPropertyId && matchable.find((p) => p._id === initialPropertyId)) {
      setSelectedId(initialPropertyId)
    }
  }, [initialPropertyId, matchable])

  React.useEffect(() => {
    if (selectedId && !matchable.find((p) => p._id === selectedId)) {
      setSelectedId(matchable[0]?._id || null)
    } else if (!selectedId && matchable[0]) {
      setSelectedId(matchable[0]._id)
    }
  }, [matchable, selectedId])

  const prop = matchable.find((p) => p._id === selectedId) || null

  const buckets = React.useMemo(() => {
    if (!prop) return { pinned: [], sent: [], suggestions: [], hold: [] }
    const { pinned, sent } = partitionAssignmentsForProperty(prop._id, assignments)
    const { send, hold } = recommendRecipients(prop, responses)
    const responseById = new Map(responses.map((r) => [r._id, r]))
    const decideFor = (responseId) => {
      const r = responseById.get(responseId)
      return r ? { response: r, decision: decide(r, prop) } : null
    }
    const pinnedEntries = pinned
      .map((a) => {
        const live = decideFor(a.responseId)
        return live ? { assignment: a, response: live.response, decision: live.decision } : null
      })
      .filter(Boolean)
    const sentEntries = sent
      .map((a) => {
        const live = decideFor(a.responseId)
        return live ? { assignment: a, response: live.response, decision: live.decision } : null
      })
      .filter(Boolean)
    const suggestions = send.filter((d) => !isPairCovered(prop._id, d.response._id, assignments))
    const holdFiltered = hold.filter((d) => !isPairCovered(prop._id, d.response._id, assignments))
    return { pinned: pinnedEntries, sent: sentEntries, suggestions, hold: holdFiltered }
  }, [prop, responses, assignments])

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
            {debouncedSearch ? `${visible.length} of ${matchable.length}` : matchable.length} matchable ·{' '}
            {responses.length} customer{responses.length === 1 ? '' : 's'} on file
          </p>
        </div>
        <div className="card-pad" style={{ paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            className="input"
            placeholder="Search condo, area, unit type, or rent…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="property-picker-list">
            {visible.length === 0 ? (
              <div className="muted" style={{ padding: 14, fontSize: 13 }}>
                No properties match this search.
              </div>
            ) : (
              visible.map((p) => {
              const { pinned, sent } = partitionAssignmentsForProperty(p._id, assignments)
              return (
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
                    {pinned.length > 0 && ` · ${pinned.length} pinned`}
                    {sent.length > 0 && ` · ${sent.length} sent`}
                  </span>
                </button>
              )
            })
            )}
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
            {prop.housingType === 'Whole Unit' &&
              typeof prop.masterCount === 'number' &&
              typeof prop.commonCount === 'number' &&
              prop.masterCount + prop.commonCount > 0 && (
                <div
                  style={{
                    padding: '12px 16px',
                    borderTop: '1px solid var(--hairline)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                    Whole unit · {prop.masterCount}M + {prop.commonCount}C — fill it by matching{' '}
                    {prop.masterCount + prop.commonCount} compatible solo customers as housemates.
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      const byPolicy = {}
                      for (const key of Object.keys(SPLIT_POLICIES)) {
                        byPolicy[key] = assembleCohort(prop, responses, { splitPolicy: key })
                      }
                      setCohortComparison({ byPolicy, dismissed: new Set() })
                    }}
                  >
                    <Icon name="check" size={12} /> Suggest cohorts
                  </button>
                </div>
              )}
          </div>
        )}

        {cohortComparison && prop && (
          <CohortComparisonRow
            comparison={cohortComparison}
            property={prop}
            onDismissPolicy={(policyKey) =>
              setCohortComparison((curr) => {
                if (!curr) return curr
                const next = new Set(curr.dismissed)
                next.add(policyKey)
                return { ...curr, dismissed: next }
              })
            }
          />
        )}

        <AssignmentSection title="Must send" subtitle="Pinned — outreach not yet sent." count={buckets.pinned.length} kind="must-send">
          {buckets.pinned.length === 0 ? (
            <SectionEmpty>No pins yet. Use [Pin] on a Suggestion to commit.</SectionEmpty>
          ) : (
            buckets.pinned.map((d, idx) => (
              <ClientMatchCard
                key={d.assignment._id}
                variant="must-send"
                response={d.response}
                decision={d.decision}
                property={prop}
                assignment={d.assignment}
                isOpen={!!expanded[d.assignment._id]}
                onToggle={() =>
                  setExpanded((e) => ({ ...e, [d.assignment._id]: !e[d.assignment._id] }))
                }
                actions={actions}
                toast={toast}
                rank={idx + 1}
              />
            ))
          )}
        </AssignmentSection>

        <AssignmentSection title="Sent" subtitle="Outreach the operator has confirmed went out." count={buckets.sent.length} kind="sent">
          {buckets.sent.length === 0 ? (
            <SectionEmpty>Nothing sent for this property yet.</SectionEmpty>
          ) : (
            buckets.sent.map((d) => (
              <ClientMatchCard
                key={d.assignment._id}
                variant="sent"
                response={d.response}
                decision={d.decision}
                property={prop}
                assignment={d.assignment}
                isOpen={!!expanded[d.assignment._id]}
                onToggle={() =>
                  setExpanded((e) => ({ ...e, [d.assignment._id]: !e[d.assignment._id] }))
                }
                actions={actions}
                toast={toast}
              />
            ))
          )}
        </AssignmentSection>

        <AssignmentSection title="Suggestions" subtitle="Live decide() Send bucket, excluding pairs already covered." count={buckets.suggestions.length} kind="suggestion">
          {buckets.suggestions.length === 0 ? (
            <SectionEmpty>No fresh suggestions — every fit is already pinned or sent.</SectionEmpty>
          ) : (
            buckets.suggestions.map((d, idx) => (
              <ClientMatchCard
                key={d.response._id ?? d.response.name + idx}
                variant="suggestion"
                rank={idx + 1}
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
                actions={actions}
                toast={toast}
              />
            ))
          )}
        </AssignmentSection>

        <AssignmentSection title="Held back" subtitle="Engine says don't send. Override only when you know something the engine doesn't." count={buckets.hold.length} kind="hold">
          {buckets.hold.length === 0 ? (
            <SectionEmpty>No one held back — every customer is a fit.</SectionEmpty>
          ) : (
            buckets.hold.map((d, idx) => (
              <ClientMatchCard
                key={d.response._id ?? d.response.name + idx}
                variant="hold"
                response={d.response}
                decision={d.decision}
                property={prop}
                isOpen={false}
                onToggle={() => {}}
                actions={actions}
                toast={toast}
              />
            ))
          )}
        </AssignmentSection>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEW 2 — By client
// ─────────────────────────────────────────────────────────────────────────────
const SCHOOL_FILTERS = ['All', 'NUS', 'NTU', 'SMU', 'OTHER']

function ByClientView({ properties, responses, assignments, actions, toast }) {
  const [school, setSchool] = React.useState('All')
  const [search, setSearch] = React.useState('')
  const [selectedId, setSelectedId] = React.useState(responses[0]?._id || null)
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

  const buckets = React.useMemo(() => {
    if (!client) return { pinned: [], sent: [], suggestions: [], hold: [] }
    const { pinned, sent } = partitionAssignmentsForClient(client._id, assignments)
    const { send, hold } = recommendListingsForClient(client, properties)
    const propertyById = new Map(properties.map((p) => [p._id, p]))
    const decideForProperty = (propertyId) => {
      const p = propertyById.get(propertyId)
      if (!p || !propertyIsMatchable(p)) return null
      return { property: p, decision: decide(client, p) }
    }
    const pinnedEntries = pinned
      .map((a) => {
        const live = decideForProperty(a.propertyId)
        return live ? { assignment: a, property: live.property, decision: live.decision } : null
      })
      .filter(Boolean)
    const sentEntries = sent
      .map((a) => {
        const live = decideForProperty(a.propertyId)
        return live ? { assignment: a, property: live.property, decision: live.decision } : null
      })
      .filter(Boolean)
    const suggestions = send.filter(
      (d) => !isPairCovered(d.property._id, client._id, assignments),
    )
    const holdFiltered = hold.filter(
      (d) => !isPairCovered(d.property._id, client._id, assignments),
    )
    return { pinned: pinnedEntries, sent: sentEntries, suggestions, hold: holdFiltered }
  }, [client, properties, assignments])

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
              filtered.map((r) => {
                const { pinned, sent } = partitionAssignmentsForClient(r._id, assignments)
                return (
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
                      {pinned.length > 0 && ` · ${pinned.length} pinned`}
                      {sent.length > 0 && ` · ${sent.length} sent`}
                    </span>
                  </button>
                )
              })
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

        <AssignmentSection title="Must send" subtitle="Properties pinned for this client — outreach not yet sent." count={buckets.pinned.length} kind="must-send">
          {buckets.pinned.length === 0 ? (
            <SectionEmpty>No pins yet for this client.</SectionEmpty>
          ) : (
            buckets.pinned.map((d, idx) => (
              <PropertyMatchCard
                key={d.assignment._id}
                variant="must-send"
                rank={idx + 1}
                property={d.property}
                decision={d.decision}
                client={client}
                assignment={d.assignment}
                isOpen={!!expanded[d.assignment._id]}
                onToggle={() => setExpanded((e) => ({ ...e, [d.assignment._id]: !e[d.assignment._id] }))}
                actions={actions}
                toast={toast}
              />
            ))
          )}
        </AssignmentSection>

        <AssignmentSection title="Sent" subtitle="Properties already sent to this client." count={buckets.sent.length} kind="sent">
          {buckets.sent.length === 0 ? (
            <SectionEmpty>Nothing sent to this client yet.</SectionEmpty>
          ) : (
            buckets.sent.map((d) => (
              <PropertyMatchCard
                key={d.assignment._id}
                variant="sent"
                property={d.property}
                decision={d.decision}
                client={client}
                assignment={d.assignment}
                isOpen={!!expanded[d.assignment._id]}
                onToggle={() => setExpanded((e) => ({ ...e, [d.assignment._id]: !e[d.assignment._id] }))}
                actions={actions}
                toast={toast}
              />
            ))
          )}
        </AssignmentSection>

        <AssignmentSection title="Suggestions" subtitle="Live decide() output, excluding pairs already covered." count={buckets.suggestions.length} kind="suggestion">
          {buckets.suggestions.length === 0 ? (
            <SectionEmpty>No fresh suggestions for this client.</SectionEmpty>
          ) : (
            buckets.suggestions.map((d, idx) => (
              <PropertyMatchCard
                key={d.property._id}
                variant="suggestion"
                rank={idx + 1}
                property={d.property}
                decision={d.decision}
                client={client}
                isOpen={!!expanded[d.property._id]}
                onToggle={() => setExpanded((e) => ({ ...e, [d.property._id]: !e[d.property._id] }))}
                actions={actions}
                toast={toast}
              />
            ))
          )}
        </AssignmentSection>

        <AssignmentSection title="Held back" subtitle="Engine says don't send. Override only when you know something the engine doesn't." count={buckets.hold.length} kind="hold">
          {buckets.hold.length === 0 ? (
            <SectionEmpty>Every property fits this customer.</SectionEmpty>
          ) : (
            buckets.hold.map((d) => (
              <PropertyMatchCard
                key={d.property._id}
                variant="hold"
                property={d.property}
                decision={d.decision}
                client={client}
                isOpen={false}
                onToggle={() => {}}
                actions={actions}
                toast={toast}
              />
            ))
          )}
        </AssignmentSection>
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

function AssignmentSection({ title, subtitle, count, kind, children }) {
  return (
    <div className={`assignment-section assignment-section--${kind}`}>
      <div className="assignment-section-head">
        <span className="assignment-section-title">{title}</span>
        <span className="assignment-section-count">{count}</span>
        {subtitle && <span className="assignment-section-sub">{subtitle}</span>}
      </div>
      <div className="assignment-section-body">{children}</div>
    </div>
  )
}

function SectionEmpty({ children }) {
  return <div className="assignment-section-empty">{children}</div>
}

function ScorePair({ pinnedScore, currentScore }) {
  if (pinnedScore === undefined && currentScore === undefined) return null
  if (pinnedScore === undefined) {
    return (
      <span className="score-pair">
        <span className="score-pair-now">{currentScore}/100</span>
      </span>
    )
  }
  if (currentScore === undefined || currentScore === pinnedScore) {
    return (
      <span className="score-pair">
        <span className="score-pair-pin">pinned at {pinnedScore}</span>
      </span>
    )
  }
  return (
    <span className="score-pair">
      <span className="score-pair-pin">pinned at {pinnedScore}</span>
      <span className="score-pair-sep">·</span>
      <span className="score-pair-now">now {currentScore}</span>
    </span>
  )
}

// Thousands-separator-aware S$ number formatter (no currency prefix — caller adds `S$`).
// Friendly explanation for each cohort-assembly failure reason. Surfaced as the
// banner copy when `assembleCohort` returns `cohort: null`.
const COHORT_REASON_COPY = {
  property_not_splittable: "This unit isn't set up for cohort matching — set master + common room counts in the listing editor.",
  no_eligible_candidates: 'No customers in the pool opted in to roommates (wantRoommate=true).',
  pool_too_small: 'Not enough opted-in solo customers to fill every bedroom.',
  no_fit_pair: 'No two compatible customers in the pool — every pair is blocked on budget, consent, or lease length.',
  cohort_incomplete: 'Found a starting pair but couldn’t extend to the full cohort — pool too thin or too divergent.',
  no_valid_room_assignment: 'Compatible cohort found but no room assignment fits every member’s budget.',
}

// Wraps three CohortResultCards (one per split policy) in a horizontal grid.
// Each card is independently dismissible. When all three are dismissed, the
// whole row returns null so the layout collapses cleanly.
function CohortComparisonRow({ comparison, property, onDismissPolicy }) {
  if (!comparison || !property) return null
  const policyKeys = Object.keys(SPLIT_POLICIES)
  const visible = policyKeys.filter((p) => !comparison.dismissed.has(p))
  if (visible.length === 0) return null

  const fitCount = visible.filter((p) => comparison.byPolicy[p]?.cohort != null).length

  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          background: 'var(--cream, #fff8ec)',
          border: '1px solid var(--hairline)',
          borderRadius: 6,
          marginBottom: 8,
          fontSize: 12,
        }}
      >
        <div>
          <strong>Cohort suggestions across split policies.</strong>{' '}
          <span style={{ color: 'var(--ink-mute)' }}>
            Operator picks the policy the tenants accept.
          </span>
        </div>
        <div style={{ color: 'var(--ink-mute)' }}>
          {fitCount} of {visible.length} produced a cohort
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {visible.map((key) => (
          <div key={key} style={{ flex: '1 1 280px', minWidth: 280 }}>
            <CohortResultCard
              result={comparison.byPolicy[key]}
              property={property}
              policy={key}
              onDismiss={() => onDismissPolicy(key)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function CohortResultCard({ result, property, policy, onDismiss }) {
  if (!result) return null

  // Policy header — label + per-room rents under that policy. Computed from
  // splitRent so the card stays honest even if the assembler short-circuited.
  const policyMeta = policy ? SPLIT_POLICIES[policy] : null
  const split = policy ? splitRent(property, policy) : null
  const rentLine = split
    ? [
        split.master != null && `master S$${formatSGD(Math.round(split.master))}`,
        split.common != null && `common S$${formatSGD(Math.round(split.common))}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : null

  // Failure path — show the structured reason.
  if (!result.cohort) {
    return (
      <div className="card" style={{ marginBottom: 18, borderLeft: '3px solid var(--warn, #b88500)' }}>
        <div
          className="card-pad"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}
        >
          <div>
            {policyMeta && (
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {policyMeta.label}
              </div>
            )}
            {rentLine && (
              <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
                {rentLine}
              </div>
            )}
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginTop: policyMeta ? 6 : 0, marginBottom: 4 }}>
              No cohort suggestion
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
              {COHORT_REASON_COPY[result.reason] || `Assembly failed: ${result.reason}.`}
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss}>
            <Icon name="x" size={12} />
          </button>
        </div>
      </div>
    )
  }

  // Success path.
  const { cohort, cohortScore, roomAssignments, notes, pairFits } = result
  const target = (property.masterCount || 0) + (property.commonCount || 0)
  const keyOf = (m, idx) => m?._id ?? `m${idx}`

  return (
    <div className="card" style={{ marginBottom: 18, borderLeft: '3px solid var(--navy, #041F60)' }}>
      <div
        className="card-pad"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}
      >
        <div>
          {policyMeta && (
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {policyMeta.label}
            </div>
          )}
          {rentLine && (
            <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
              {rentLine}
            </div>
          )}
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginTop: policyMeta ? 6 : 0 }}>
            Suggested cohort · {cohort.length} of {target}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>
            Cohort fit {cohortScore}/100 · rents conserve to S${formatSGD(property.rentSGD)}/mo
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss}>
          <Icon name="x" size={12} />
        </button>
      </div>
      <div className="card-pad" style={{ paddingTop: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cohort.map((m, idx) => {
            const k = keyOf(m, idx)
            const slot = roomAssignments[k]
            return (
              <div
                key={k}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 10px',
                  background: 'var(--cream, #fff8ec)',
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{m.name || 'Unnamed'}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                    {m.school} · budget S${formatSGD(m.budget?.min)}–{formatSGD(m.budget?.max)} · {m.leaseLength || '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 600 }}>
                    S${formatSGD(slot?.rent)} <span style={{ fontWeight: 400, color: 'var(--ink-mute)' }}>{slot?.roomKind}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {pairFits && pairFits.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--ink-mute)' }}>
            Pair-fits: {pairFits.map((p, i) => `${p.score}/100`).join(' · ')}
          </div>
        )}

        {notes && notes.length > 0 && (
          <ul style={{ marginTop: 12, paddingLeft: 18, fontSize: 12, color: 'var(--ink)' }}>
            {notes.map((n, i) => (
              <li key={i} style={{ marginBottom: 4 }}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

const sgdFormatter = new Intl.NumberFormat('en-SG', { maximumFractionDigits: 0 })
function formatSGD(n) {
  return typeof n === 'number' && Number.isFinite(n) ? sgdFormatter.format(n) : String(n ?? '')
}

function relativeTime(ms) {
  if (!ms) return ''
  const diff = Date.now() - ms
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  if (d < 14) return `${d}d ago`
  return new Date(ms).toLocaleDateString('en-SG', { month: 'short', day: 'numeric' })
}

// ─────────────────────────────────────────────────────────────────────────────
// Match cards — render a single (property, client) pair in one of four
// variants:
//   suggestion — live decide() Send-bucket row, [Pin] available
//   must-send  — pinned not sent, [Mark sent] + [Unpin] + [Draft] available
//   sent       — read-only audit row, [Draft] (for reference) available
//   hold       — decide() Hold-bucket row, [Override and pin] gated by confirm
// ─────────────────────────────────────────────────────────────────────────────

function ClientMatchCard({ variant, rank, response, decision, property, assignment, isOpen, onToggle, actions, toast }) {
  const isSuggestion = variant === 'suggestion'
  const isMustSend = variant === 'must-send'
  const isSent = variant === 'sent'
  const isHold = variant === 'hold'
  const draft = React.useMemo(
    () => draftMessage(response, property, decision),
    [response, property, decision],
  )

  const copy = () => {
    navigator.clipboard?.writeText(draft)
    toast?.('Draft copied — paste into Line/IG.')
  }

  const onPin = async () => {
    await actions.pin({
      propertyId: property._id,
      responseId: response._id,
      pinnedScore: decision.score,
    })
  }

  const onOverridePin = async () => {
    const ok = window.confirm(
      `This client scored ${decision.score}/100 (below send threshold). Pin anyway?`,
    )
    if (!ok) return
    await actions.pin({
      propertyId: property._id,
      responseId: response._id,
      pinnedScore: decision.score,
      pinnedReason: 'operator-override',
    })
  }

  const onUnpin = async () => {
    if (!assignment) return
    await actions.unpin(assignment._id)
  }

  const onMarkSent = async () => {
    if (!assignment) return
    await actions.markSent(assignment._id, response.channel)
  }

  return (
    <div className="match-card">
      <div className="match-rank">
        {isMustSend ? (
          <>
            <Icon name="check" size={20} />
            <span className="small">Pinned</span>
          </>
        ) : isSent ? (
          <>
            <Icon name="send" size={20} />
            <span className="small">Sent</span>
          </>
        ) : isSuggestion ? (
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
        {(isMustSend || isSent) && assignment && (
          <div className="meta">
            <ScorePair pinnedScore={assignment.pinnedScore} currentScore={decision.score} />
            {isMustSend && (
              <span style={{ marginLeft: 10 }}>pinned {relativeTime(assignment.pinnedAt)}</span>
            )}
            {isSent && (
              <span style={{ marginLeft: 10 }}>
                sent {relativeTime(assignment.sentAt)}{assignment.sentVia ? ` · via ${assignment.sentVia}` : ''}
              </span>
            )}
          </div>
        )}
        <div className="reason" style={{ color: isHold ? 'var(--danger)' : 'var(--ink)' }}>
          {isMustSend ? (
            <Pill kind="navy" dot>Must send</Pill>
          ) : isSent ? (
            <Pill kind="green" dot>Sent</Pill>
          ) : isSuggestion ? (
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
        {isSuggestion && (
          <>
            <div className="match-score">{decision.score}<span className="total">/100</span></div>
            <button className="btn btn-primary btn-sm" onClick={onPin}>
              <Icon name="check" size={12} /> Pin
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onToggle}>
              <Icon name="mail" size={12} /> {isOpen ? 'Hide' : 'Draft'}
            </button>
          </>
        )}
        {isMustSend && (
          <>
            <button className="btn btn-primary btn-sm" onClick={onMarkSent}>
              <Icon name="send" size={12} /> Mark sent
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onToggle}>
              <Icon name="mail" size={12} /> {isOpen ? 'Hide' : 'Draft'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onUnpin}>
              Unpin
            </button>
          </>
        )}
        {isSent && (
          <button className="btn btn-ghost btn-sm" onClick={onToggle}>
            <Icon name="mail" size={12} /> {isOpen ? 'Hide' : 'Draft'}
          </button>
        )}
        {isHold && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--ink-mute)', textAlign: 'right', maxWidth: 140 }}>
              Score {decision.score}/100
              <br />
              Held back, not blasted.
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onOverridePin}>
              Override and pin
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function PropertyMatchCard({ variant, rank, property, decision, client, assignment, isOpen, onToggle, actions, toast }) {
  const isSuggestion = variant === 'suggestion'
  const isMustSend = variant === 'must-send'
  const isSent = variant === 'sent'
  const isHold = variant === 'hold'
  const isUnextracted = decision.blockers?.includes('unextracted')
  const draft = React.useMemo(
    () => (client && !isHold ? draftMessage(client, property, decision) : ''),
    [client, property, decision, isHold],
  )

  const copy = () => {
    navigator.clipboard?.writeText(draft)
    toast?.('Draft copied — paste into Line/IG.')
  }

  const onPin = async () => {
    await actions.pin({
      propertyId: property._id,
      responseId: client._id,
      pinnedScore: decision.score,
    })
  }

  const onOverridePin = async () => {
    const ok = window.confirm(
      `This property scored ${decision.score}/100 against this client (below send threshold). Pin anyway?`,
    )
    if (!ok) return
    await actions.pin({
      propertyId: property._id,
      responseId: client._id,
      pinnedScore: decision.score,
      pinnedReason: 'operator-override',
    })
  }

  const onUnpin = async () => {
    if (!assignment) return
    await actions.unpin(assignment._id)
  }

  const onMarkSent = async () => {
    if (!assignment) return
    await actions.markSent(assignment._id, client.channel)
  }

  return (
    <div className="match-card">
      <div className="match-rank">
        {isMustSend ? (
          <>
            <Icon name="check" size={20} />
            <span className="small">Pinned</span>
          </>
        ) : isSent ? (
          <>
            <Icon name="send" size={20} />
            <span className="small">Sent</span>
          </>
        ) : isSuggestion ? (
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
            {typeof property.rentSGD === 'number' ? ` · S$${formatSGD(property.rentSGD)}/mo` : ''}
          </span>
        </div>
        {decision.groupContext && (
          <div className="meta" style={{ color: 'var(--ink-mute)' }}>
            Split for {decision.groupContext.groupSize}:{' '}
            {decision.groupContext.split.master != null && (
              <>S${formatSGD(Math.round(decision.groupContext.split.master))} master</>
            )}
            {decision.groupContext.split.master != null && decision.groupContext.split.common != null && ' / '}
            {decision.groupContext.split.common != null && (
              <>S${formatSGD(Math.round(decision.groupContext.split.common))} common</>
            )}
            {' · per person'}
          </div>
        )}
        <div className="meta">
          {property.buildingType || '—'}
          {property.commuteMins && client?.school && client.school !== 'OTHER'
            ? ` · ${property.commuteMins[client.school] ?? '—'}min to ${client.school}`
            : ''}
          {property.posterStorageId ? ' · poster ready' : ' · no poster yet'}
        </div>
        {(isMustSend || isSent) && assignment && (
          <div className="meta">
            <ScorePair pinnedScore={assignment.pinnedScore} currentScore={decision.score} />
            {isMustSend && (
              <span style={{ marginLeft: 10 }}>pinned {relativeTime(assignment.pinnedAt)}</span>
            )}
            {isSent && (
              <span style={{ marginLeft: 10 }}>
                sent {relativeTime(assignment.sentAt)}{assignment.sentVia ? ` · via ${assignment.sentVia}` : ''}
              </span>
            )}
          </div>
        )}
        <div className="reason" style={{ color: isHold ? 'var(--danger)' : 'var(--ink)' }}>
          {isMustSend ? (
            <Pill kind="navy" dot>Must send</Pill>
          ) : isSent ? (
            <Pill kind="green" dot>Sent</Pill>
          ) : isSuggestion ? (
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

        {isOpen && draft && (
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
        {isSuggestion && (
          <>
            <div className="match-score">{decision.score}<span className="total">/100</span></div>
            <button className="btn btn-primary btn-sm" onClick={onPin}>
              <Icon name="check" size={12} /> Pin
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onToggle}>
              <Icon name="mail" size={12} /> {isOpen ? 'Hide' : 'Draft'}
            </button>
          </>
        )}
        {isMustSend && (
          <>
            <button className="btn btn-primary btn-sm" onClick={onMarkSent}>
              <Icon name="send" size={12} /> Mark sent
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onToggle}>
              <Icon name="mail" size={12} /> {isOpen ? 'Hide' : 'Draft'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onUnpin}>
              Unpin
            </button>
          </>
        )}
        {isSent && (
          <button className="btn btn-ghost btn-sm" onClick={onToggle}>
            <Icon name="mail" size={12} /> {isOpen ? 'Hide' : 'Draft'}
          </button>
        )}
        {isHold && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--ink-mute)', textAlign: 'right', maxWidth: 160 }}>
              {isUnextracted ? 'Awaits extraction' : `Score ${decision.score}/100`}
              <br />
              {isUnextracted ? 'Attach a poster.' : 'Held back, not blasted.'}
            </div>
            {!isUnextracted && (
              <button className="btn btn-ghost btn-sm" onClick={onOverridePin}>
                Override and pin
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

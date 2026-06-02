// Shared helpers for reading the `assignments` ledger.
//
// Tombstones (rows with `unpinnedAt` set) are excluded from every result
// here — they live in the database for audit only and must not surface
// in the UI. Sort order is newest-first by the relevant timestamp.

// Split a property's assignments into active-pinned and sent lists.
export function partitionAssignmentsForProperty(propertyId, assignments) {
  const pinned = []
  const sent = []
  for (const a of assignments || []) {
    if (a.propertyId !== propertyId) continue
    if (a.unpinnedAt !== undefined) continue
    if (a.status === 'pinned') pinned.push(a)
    else if (a.status === 'sent') sent.push(a)
  }
  pinned.sort((a, b) => b.pinnedAt - a.pinnedAt)
  sent.sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0))
  return { pinned, sent }
}

// Symmetric — split a client's assignments by their other axis.
export function partitionAssignmentsForClient(responseId, assignments) {
  const pinned = []
  const sent = []
  for (const a of assignments || []) {
    if (a.responseId !== responseId) continue
    if (a.unpinnedAt !== undefined) continue
    if (a.status === 'pinned') pinned.push(a)
    else if (a.status === 'sent') sent.push(a)
  }
  pinned.sort((a, b) => b.pinnedAt - a.pinnedAt)
  sent.sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0))
  return { pinned, sent }
}

// True when (propertyId, responseId) has any non-tombstone assignment row.
export function isPairCovered(propertyId, responseId, assignments) {
  return (assignments || []).some(
    (a) =>
      a.propertyId === propertyId &&
      a.responseId === responseId &&
      a.unpinnedAt === undefined,
  )
}

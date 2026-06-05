import { describe, it, expect } from 'vitest'
import { hasMovedInDeal } from './deals'

// Pure-helper test. The mutations (start/advance/cancel) and the
// listWithPipelineStatus query need a Convex test harness; those are
// covered by manual walkthrough in the apply checklist for v1.

const responseId = 'res_1' as any
const otherResponseId = 'res_2' as any

function deal(stage: any, cancelled = false, who: any = responseId) {
  return { responseId: who, stage, cancelledAt: cancelled ? 1 : undefined }
}

describe('hasMovedInDeal', () => {
  it('returns false when no deals exist for the customer', () => {
    expect(hasMovedInDeal(responseId, [])).toBe(false)
    expect(hasMovedInDeal(responseId, [deal('moved_in', false, otherResponseId)])).toBe(false)
  })

  it('returns false when only earlier-stage deals exist', () => {
    expect(hasMovedInDeal(responseId, [deal('loi_sent'), deal('ta_issued')])).toBe(false)
  })

  it('returns true when a non-cancelled moved_in deal exists', () => {
    expect(hasMovedInDeal(responseId, [deal('moved_in')])).toBe(true)
  })

  it('ignores cancelled moved_in deals', () => {
    expect(hasMovedInDeal(responseId, [deal('moved_in', true)])).toBe(false)
  })

  it('handles a mix — a single live moved_in row is enough', () => {
    expect(
      hasMovedInDeal(responseId, [
        deal('moved_in', true),
        deal('loi_sent'),
        deal('moved_in', false),
      ]),
    ).toBe(true)
  })
})

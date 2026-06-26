import { describe, it, expect } from 'vitest'
import { parseRequirementMessage, buildSearchQuery } from './lib/requirementParse'

describe('parseRequirementMessage', () => {
  it('extracts recognised fields from a typical message', () => {
    const msg =
      "Hi my name is Alex Tan, contact 91234567. Looking for a common room near NUS, " +
      'budget around $2,500, condo preferred, move in immediate, 12 months lease.'
    const p = parseRequirementMessage(msg)
    expect(p.name).toBe('Alex Tan')
    expect(p.contact).toBe('91234567')
    expect(p.school).toBe('NUS')
    expect(p.buildingType).toBe('Condo')
    expect(p.housingType).toBe('Room')
    expect(p.unitLayout).toContain('Common Room')
    expect(p.budget.max).toBe(2500)
    expect(p.moveIn).toBe('Immediate')
    expect(p.leaseLength).toMatch(/12/)
  })

  it('does not read a phone number as a budget', () => {
    const p = parseRequirementMessage('contact me at 98765432, no budget mentioned')
    expect(p.contact).toBe('98765432')
    expect(p.budget).toEqual({ min: 0, max: 99999 })
  })

  it('parses a budget range and k-notation', () => {
    expect(parseRequirementMessage('budget 2k to 3k').budget).toEqual({ min: 2000, max: 3000 })
    expect(parseRequirementMessage('around 1800').budget).toEqual({ min: 1500, max: 1800 })
  })

  it('applies safe defaults when fields are missing', () => {
    const p = parseRequirementMessage('just looking for a place')
    expect(p.school).toBe('OTHER')
    expect(p.buildingType).toBe('Any')
    expect(p.housingType).toBe('Room')
    expect(p.commuteTolMins).toBe(30)
    expect(p.wantRoommate).toBe(false)
    expect(p.name).toBe('')
    expect(p.contact).toBe('')
  })

  it('detects bed/bath counts in compact and spelled-out forms', () => {
    expect(parseRequirementMessage('looking for a 2b1b condo')).toMatchObject({
      bedrooms: 2,
      bathrooms: 1,
    })
    expect(parseRequirementMessage('2br1ba near NUS')).toMatchObject({ bedrooms: 2, bathrooms: 1 })
    expect(parseRequirementMessage('2bed1bath')).toMatchObject({ bedrooms: 2, bathrooms: 1 })
    expect(parseRequirementMessage('want a 3 bedroom 2 bathroom unit')).toMatchObject({
      bedrooms: 3,
      bathrooms: 2,
    })
    expect(parseRequirementMessage('3br only')).toMatchObject({ bedrooms: 3 })
    const none = parseRequirementMessage('just a room near NTU')
    expect(none.bedrooms).toBeUndefined()
    expect(none.bathrooms).toBeUndefined()
  })

  it('does not misread a budget as a bedroom count', () => {
    const p = parseRequirementMessage('budget $2500 near NUS')
    expect(p.bedrooms).toBeUndefined()
    expect(p.budget.max).toBe(2500)
  })

  it('detects roommate intent and commute tolerance', () => {
    const p = parseRequirementMessage('happy to share with a roommate, up to 25 mins commute')
    expect(p.wantRoommate).toBe(true)
    expect(p.commuteTolMins).toBe(25)
  })
})

describe('buildSearchQuery', () => {
  it('composes building + layout + school + budget', () => {
    const p = parseRequirementMessage('common room near NTU under 1500, condo')
    const q = buildSearchQuery(p)
    expect(q).toContain('condo')
    expect(q).toContain('common room')
    expect(q).toContain('for rent')
    expect(q).toContain('near NTU')
    expect(q).toContain('under 1500')
  })

  it('uses bed/bath counts in the query when present', () => {
    const q = buildSearchQuery(parseRequirementMessage('2b1b condo near NUS under 4000'))
    expect(q).toContain('2 bedroom')
    expect(q).toContain('1 bathroom')
    expect(q).toContain('condo')
    expect(q).toContain('near NUS')
  })

  it('omits area/budget when unknown and falls back to housing type', () => {
    const q = buildSearchQuery(parseRequirementMessage('whole unit somewhere'))
    expect(q).toContain('whole unit')
    expect(q).toContain('for rent')
    expect(q).not.toContain('near')
    expect(q).not.toContain('under')
  })
})

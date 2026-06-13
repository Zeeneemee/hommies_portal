import { describe, it, expect } from 'vitest'
import { deriveBedroomTag, mergeBedroomTag, BEDROOM_TAG_RE } from './lib/bedroomTags'

describe('deriveBedroomTag', () => {
  it('maps a whole-unit count to <n>BR', () => {
    expect(deriveBedroomTag({ bedrooms: 2 })).toBe('2BR')
    expect(deriveBedroomTag({ bedrooms: 1 })).toBe('1BR')
  })

  it('prefers Studio when unitType says studio, regardless of count', () => {
    expect(deriveBedroomTag({ bedrooms: 1, unitType: 'Studio' })).toBe('Studio')
    expect(deriveBedroomTag({ unitType: 'studio apartment' })).toBe('Studio')
  })

  it('returns undefined when no usable count is known', () => {
    expect(deriveBedroomTag({})).toBeUndefined()
    expect(deriveBedroomTag({ bedrooms: 0 })).toBeUndefined()
    expect(deriveBedroomTag({ bedrooms: 2.5 })).toBeUndefined()
    expect(deriveBedroomTag({ bedrooms: null, unitType: null })).toBeUndefined()
  })
})

describe('mergeBedroomTag', () => {
  it('replaces a prior bedroom tag while keeping non-bedroom tags', () => {
    expect(mergeBedroomTag(['2BR', 'whole-unit'], '3BR')).toEqual(['whole-unit', '3BR'])
  })

  it('is idempotent — re-merging the same tag does not duplicate', () => {
    expect(mergeBedroomTag(['2BR'], '2BR')).toEqual(['2BR'])
    expect(mergeBedroomTag(mergeBedroomTag([], '2BR'), '2BR')).toEqual(['2BR'])
  })

  it('strips bedroom tags when given no new tag', () => {
    expect(mergeBedroomTag(['2BR', 'furnished'], undefined)).toEqual(['furnished'])
  })

  it('swaps Studio and numeric tags cleanly', () => {
    expect(mergeBedroomTag(['Studio', 'condo'], '2BR')).toEqual(['condo', '2BR'])
    expect(mergeBedroomTag(['1BR'], 'Studio')).toEqual(['Studio'])
  })

  it('de-dups non-bedroom tags too', () => {
    expect(mergeBedroomTag(['condo', 'condo'], '1BR')).toEqual(['condo', '1BR'])
  })
})

describe('BEDROOM_TAG_RE', () => {
  it('matches bedroom tags only', () => {
    expect(BEDROOM_TAG_RE.test('2BR')).toBe(true)
    expect(BEDROOM_TAG_RE.test('Studio')).toBe(true)
    expect(BEDROOM_TAG_RE.test('furnished')).toBe(false)
    expect(BEDROOM_TAG_RE.test('2 BR')).toBe(false)
  })
})

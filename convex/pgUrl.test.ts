import { describe, it, expect } from 'vitest'
import {
  isPropertyGuruHost,
  isPropertyGuruListing,
  buildPropertyGuruSearchUrl,
  extractListingLinks,
} from './lib/pgUrl'
import { parseRequirementMessage } from './lib/requirementParse'

describe('isPropertyGuruHost', () => {
  it('accepts propertyguru.com.sg and subdomains', () => {
    expect(isPropertyGuruHost('https://www.propertyguru.com.sg/listing/123')).toBe(true)
    expect(isPropertyGuruHost('https://propertyguru.com.sg/anything')).toBe(true)
  })
  it('rejects other hosts and junk', () => {
    expect(isPropertyGuruHost('https://99.co/singapore/rent')).toBe(false)
    expect(isPropertyGuruHost('not a url')).toBe(false)
  })
})

describe('buildPropertyGuruSearchUrl', () => {
  it('encodes bedrooms, price and school for "2b1b smu budget 3300max"', () => {
    const p = parseRequirementMessage('Emily 亮妤 2b1b smu budget 3300max 50min')
    const url = buildPropertyGuruSearchUrl(p)
    expect(url).toContain('/property-for-rent?')
    expect(url).toContain('beds%5B%5D=2') // beds[]=2
    expect(url).toContain('maxprice=3300')
    expect(url).toContain('freetext=SMU')
  })

  it('omits filters that are unknown', () => {
    const url = buildPropertyGuruSearchUrl(parseRequirementMessage('just a room'))
    expect(url).not.toContain('beds%5B%5D')
    expect(url).not.toContain('maxprice')
  })
})

describe('extractListingLinks', () => {
  it('pulls and de-duplicates listing links from search HTML', () => {
    const html = `
      <a href="/listing/24681012-nice-2-bedroom-condo">x</a>
      <a href="https://www.propertyguru.com.sg/listing/24681012-nice-2-bedroom-condo">dup</a>
      <a href="/listing/99887766-another-unit">y</a>
      <a href="/project/lake-grande">not a listing</a>
    `
    const links = extractListingLinks(html, 5)
    expect(links).toHaveLength(2)
    expect(links[0].url).toBe('https://www.propertyguru.com.sg/listing/24681012-nice-2-bedroom-condo')
    expect(links[0].title).toContain('Bedroom')
  })

  it('respects the limit', () => {
    const html = Array.from({ length: 10 }, (_, i) => `/listing/${1000 + i}-unit`).join(' ')
    expect(extractListingLinks(html, 3)).toHaveLength(3)
  })
})

describe('isPropertyGuruListing', () => {
  it('only accepts /listing/ paths on PropertyGuru', () => {
    expect(isPropertyGuruListing('https://www.propertyguru.com.sg/listing/24681012-a-room')).toBe(true)
    expect(isPropertyGuruListing('https://www.propertyguru.com.sg/project/lake-grande')).toBe(false)
    expect(isPropertyGuruListing('https://www.propertyguru.com.sg/property-for-rent')).toBe(false)
    expect(isPropertyGuruListing('https://99.co/singapore/rent/listing/123')).toBe(false)
  })
})

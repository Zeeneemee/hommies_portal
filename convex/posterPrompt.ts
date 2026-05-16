// Static template for the /room-showcase-pdf brief — deterministic fallback
// used when Gemini is unavailable. Kept inside convex/ so the action bundle
// stays self-contained (no imports outside convex/).
//
// As of the simplify-add-property change the payload is the bare minimum —
// the property name and the uploaded image filenames. The brief asks Claude
// to derive every physical detail (rent, area, building type, age, room type,
// commute) from the photos themselves, and to print an explicit labeled
// text block on the poster so the portal can lift those values back later
// via PDF text extraction.

export type PropertyForPrompt = {
  condo: string
  images?: Array<{ name: string }>
}

export function buildPosterPrompt(f: PropertyForPrompt): string {
  const lines: string[] = []
  lines.push('/room-showcase-pdf')
  lines.push('')
  lines.push(
    `Please produce a single-page Hommies.sg room showcase PDF for the property below. Brand it warm (orange #fd6925, navy #041f60, cream #fff5ec). Keep tone family-first — "housemates becoming homies", never corporate. Footer line on every poster: "We connect students with authorized agents — we are not agents."`,
  )
  lines.push('')
  lines.push('── PROPERTY ──')
  lines.push(`Name: ${f.condo}`)
  lines.push('')
  lines.push('── IMAGES (attached to this chat) ──')
  const images = f.images || []
  if (images.length === 0) {
    lines.push('(no images attached yet — use textured placeholders, label what each frame should show)')
  } else {
    images.forEach((img) => lines.push(`  • ${img.name}`))
  }
  lines.push('')
  lines.push('── DERIVE FROM THE PHOTOS ──')
  lines.push(
    'Look at the images and infer the physical details you would normally need to be told: building type (Condo or HDB), housing type (Room or Whole Unit), room type (Common Room / Master Room / Studio / Whole Unit), approximate age of the building, area / neighbourhood (use the most likely guess), and a reasonable monthly rent for that combination in Singapore.',
  )
  lines.push(
    'When the photos make a value impossible to call, pick a sensible default and note that it is estimated — never invent precise specifics you cannot see.',
  )
  lines.push('')
  lines.push('── REQUIRED LABELED TEXT BLOCK (do not skip — the portal parses it) ──')
  lines.push(
    'Place an upright "Facts" sidebar somewhere on the poster, with each row rendered as actual text (not an image raster). Use these exact labels and one value per line:',
  )
  lines.push('  Monthly rent: S$<number>')
  lines.push('  Area: <neighbourhood or area>')
  lines.push('  Building type: Condo | HDB')
  lines.push('  Housing type: Room | Whole Unit')
  lines.push('  Age: <number> years')
  lines.push('  Room type: <Common Room | Master Room | Studio | Whole Unit>')
  lines.push('  Commute: NUS <min> · NTU <min> · SMU <min>')
  lines.push('')
  lines.push('── OUTPUT ──')
  lines.push('A4 portrait, single page. The four facts that must be unmissable at a glance:')
  lines.push('  1. Room type        2. Location & area')
  lines.push('  3. Condo or HDB     4. Age of the building')
  lines.push(
    'Rent should sit large and orange. Commute row beneath. Photos as a grid. Hommies wordmark top-left. Disclaimer footer. Facts sidebar with the labeled text rows above so the portal can read them back.',
  )
  lines.push('')
  lines.push('Return the finished PDF so it can be uploaded back to the internal portal.')
  return lines.join('\n')
}

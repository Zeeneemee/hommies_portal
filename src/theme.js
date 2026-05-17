// theme.js — brand token reference for any JS-side use.
// styles.css is the source of truth for the CSS custom properties; this
// module mirrors them for code that needs the values directly (e.g. inline
// styles or chart colours). Never hard-code a hex in components — read from
// here or use the matching `var(--…)` token.
export const theme = {
  color: {
    orange: '#fd6925',
    orangeSoft: '#ffe6d6',
    navy: '#041f60',
    navy2: '#0a2d7a',
    navy3: '#1a3d8a',
    cream: '#fff5ec',
    cream2: '#fffaf3',
    green: '#1d9e75',
    greenSoft: '#d6f1e6',
    grey: '#9aa0b4',
    greySoft: '#eef0f5',
    hairline: '#ecd9c8',
    hairlineStrong: '#d9c2ac',
    ink: '#041f60',
    inkSoft: '#4a5680',
    inkMute: '#7a85a8',
    danger: '#c0392b',
    dangerSoft: '#fbe5e2',
  },
  radius: { s: '6px', m: '10px', l: '14px' },
  font: {
    sans: '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif',
    display: '"Fraunces", "Inter", Georgia, serif',
  },
  // Accent palette the in-portal poster generator may pick from. Gemini
  // returns one of these keys (not arbitrary hex) and the <Poster> template
  // resolves it to the matching color below. Keep this list short and named
  // so the LLM output is bounded and easy to validate.
  posterPalette: {
    orange: '#fd6925',
    navy: '#041f60',
    green: '#1d9e75',
    cream: '#fff5ec',
  },
  posterPaletteDefault: 'orange',
}

export default theme

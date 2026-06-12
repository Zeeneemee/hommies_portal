// Shared UI primitives — Icon, Pill, Field, Segment, ChipInput, StageTrack,
// StatusPill, Toast — ported from the "Hommies Portal" design's
// components.jsx into React imports.
import React from 'react'

export const Icon = ({ name, size = 16, stroke = 1.6, ...rest }) => {
  const s = size
  const common = {
    width: s,
    height: s,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...rest,
  }
  switch (name) {
    case 'plus':
      return (
        <svg {...common}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      )
    case 'check':
      return (
        <svg {...common}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )
    case 'send':
      return (
        <svg {...common}>
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      )
    case 'upload':
      return (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      )
    case 'pdf':
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      )
    case 'list':
      return (
        <svg {...common}>
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <circle cx="4" cy="6" r="1" />
          <circle cx="4" cy="12" r="1" />
          <circle cx="4" cy="18" r="1" />
        </svg>
      )
    case 'sparkle':
      return (
        <svg {...common}>
          <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z" />
          <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z" />
        </svg>
      )
    case 'grid':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
      )
    case 'photo':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      )
    case 'copy':
      return (
        <svg {...common}>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )
    case 'arrow-right':
      return (
        <svg {...common}>
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      )
    case 'x':
      return (
        <svg {...common}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      )
    case 'mail':
      return (
        <svg {...common}>
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <polyline points="22 6 12 13 2 6" />
        </svg>
      )
    case 'trash':
      return (
        <svg {...common}>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      )
    case 'menu':
      return (
        <svg {...common}>
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      )
    case 'play':
      return (
        <svg {...common}>
          <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="currentColor" />
        </svg>
      )
    case 'video':
      return (
        <svg {...common}>
          <rect x="2" y="6" width="14" height="12" rx="2" />
          <polygon points="22 8 16 12 22 16 22 8" />
        </svg>
      )
    case 'download':
      return (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      )
    case 'external':
      return (
        <svg {...common}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      )
    default:
      return null
  }
}

export const Pill = ({ kind, children, dot }) => (
  <span className={`pill pill-${kind}`}>
    {dot && <i className="dot" />}
    {children}
  </span>
)

export const Field = ({ label, hint, required, span = 6, className = '', children }) => (
  <div className={`field col-${span}${className ? ` ${className}` : ''}`}>
    <label className="field-label">
      {label}
      {required && <span className="req">*</span>}
    </label>
    {children}
    {hint && <span className="field-hint">{hint}</span>}
  </div>
)

export const Segment = ({ options, value, onChange }) => (
  <div className="segment">
    {options.map((o) => (
      <button
        key={o}
        type="button"
        className={value === o ? 'on' : ''}
        onClick={() => onChange(o)}
      >
        {o}
      </button>
    ))}
  </div>
)

export const ChipInput = ({ values, onAdd, onRemove, placeholder }) => {
  const [v, setV] = React.useState('')
  const commit = () => {
    const t = v.trim()
    if (!t) return
    onAdd(t)
    setV('')
  }
  return (
    <div className="chip-input">
      {values.map((c, i) => (
        <span className="chip" key={i}>
          {c}
          <button type="button" onClick={() => onRemove(i)} aria-label="remove">
            <Icon name="x" size={11} />
          </button>
        </span>
      ))}
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
      />
    </div>
  )
}

const STAGES = ['data_received', 'poster_attached', 'sent']

export const StageTrack = ({ status }) => {
  const i = STAGES.indexOf(status)
  return (
    <div className="track">
      {STAGES.map((s, idx) => (
        <React.Fragment key={s}>
          <div className={`track-dot ${idx < i ? 'done' : idx === i ? 'current' : ''}`} />
          {idx < STAGES.length - 1 && <div className={`track-line ${idx < i ? 'done' : ''}`} />}
        </React.Fragment>
      ))}
    </div>
  )
}

export const StatusPill = ({ status }) => {
  if (status === 'data_received')
    return (
      <Pill kind="grey" dot>
        Data received
      </Pill>
    )
  if (status === 'poster_attached')
    return (
      <Pill kind="orange" dot>
        Poster attached
      </Pill>
    )
  if (status === 'sent')
    return (
      <Pill kind="green" dot>
        Sent
      </Pill>
    )
  return null
}

export const Toast = ({ msg, onDone }) => {
  React.useEffect(() => {
    if (!msg) return
    const t = setTimeout(onDone, 2400)
    return () => clearTimeout(t)
  }, [msg, onDone])
  if (!msg) return null
  return (
    <div className="toast">
      <span className="ok" />
      {msg}
    </div>
  )
}

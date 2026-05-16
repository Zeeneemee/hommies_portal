import React from 'react'
import { Icon, Field, Segment } from './ui.jsx'

// Used for walk-ins and DM enquiries that didn't go through the Google Form.
export default function ManualResponseModal({ onClose, onSave }) {
  const [r, setR] = React.useState({
    name: '',
    channel: 'WhatsApp',
    contact: '',
    school: 'NUS',
    moveIn: '',
    leaseLength: '12 months',
    budget: { min: 1200, max: 1600 },
    buildingType: 'Any',
    housingType: 'Room',
    unitLayout: ['Common Room'],
    commuteTolMins: 25,
    wantRoommate: true,
    extras: { petFriendly: false, cookingAllowed: true, quiet: false, nearGym: false, note: '' },
  })
  const upd = (k, v) => setR((s) => ({ ...s, [k]: v }))
  const toggleLayout = (l) =>
    setR((s) => ({
      ...s,
      unitLayout: s.unitLayout.includes(l) ? s.unitLayout.filter((x) => x !== l) : [...s.unitLayout, l],
    }))

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(4,31,96,0.4)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 200,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 640, maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="card-head"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
        >
          <div>
            <h3 className="card-title">Add response manually</h3>
            <p className="card-sub">For walk-ins and DM enquiries that didn't go through the Google Form.</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="card-pad">
          <div className="form-grid">
            <Field label="Name (姓名)" required span={6}>
              <input
                className="input"
                value={r.name}
                onChange={(e) => upd('name', e.target.value)}
                placeholder="Wei Lin Tan / 陳維琳"
              />
            </Field>
            <Field label="Channel" span={3}>
              <select className="select" value={r.channel} onChange={(e) => upd('channel', e.target.value)}>
                <option>WhatsApp</option>
                <option>Line</option>
                <option>Instagram</option>
                <option>Walk-in</option>
                <option>Form</option>
              </select>
            </Field>
            <Field label="Contact" span={3}>
              <input className="input" value={r.contact} onChange={(e) => upd('contact', e.target.value)} placeholder="@handle" />
            </Field>

            <Field label="School" span={3}>
              <Segment options={['NUS', 'NTU', 'SMU']} value={r.school} onChange={(v) => upd('school', v)} />
            </Field>
            <Field label="Move-in" span={3}>
              <input className="input" type="date" value={r.moveIn} onChange={(e) => upd('moveIn', e.target.value)} />
            </Field>
            <Field label="Lease length" span={3}>
              <select className="select" value={r.leaseLength} onChange={(e) => upd('leaseLength', e.target.value)}>
                <option>6 months</option>
                <option>12 months</option>
                <option>24 months</option>
              </select>
            </Field>
            <Field label="Commute tolerance" span={3}>
              <div className="input-prefix">
                <span className="px">min</span>
                <input
                  value={r.commuteTolMins}
                  onChange={(e) => upd('commuteTolMins', +e.target.value || 0)}
                  inputMode="numeric"
                />
              </div>
            </Field>

            <Field label="Budget min" span={3}>
              <div className="input-prefix">
                <span className="px">S$</span>
                <input
                  value={r.budget.min}
                  onChange={(e) => upd('budget', { ...r.budget, min: +e.target.value || 0 })}
                  inputMode="numeric"
                />
              </div>
            </Field>
            <Field label="Budget max" span={3}>
              <div className="input-prefix">
                <span className="px">S$</span>
                <input
                  value={r.budget.max}
                  onChange={(e) => upd('budget', { ...r.budget, max: +e.target.value || 0 })}
                  inputMode="numeric"
                />
              </div>
            </Field>
            <Field label="Building" span={3}>
              <select className="select" value={r.buildingType} onChange={(e) => upd('buildingType', e.target.value)}>
                <option>Any</option>
                <option>Condo</option>
                <option>HDB</option>
              </select>
            </Field>
            <Field label="Housing" span={3}>
              <Segment options={['Room', 'Whole Unit']} value={r.housingType} onChange={(v) => upd('housingType', v)} />
            </Field>

            <Field label="Unit layout (multi-select)" span={12}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['Common Room', 'Master Room', 'Studio', 'Whole Unit'].map((l) => (
                  <button
                    type="button"
                    key={l}
                    onClick={() => toggleLayout(l)}
                    className={`filter-chip ${r.unitLayout.includes(l) ? 'on' : ''}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Notes / extras" span={12}>
              <textarea
                className="textarea"
                value={r.extras.note}
                onChange={(e) => upd('extras', { ...r.extras, note: e.target.value })}
                placeholder="Anything else — pets, cooking, gym, quiet, etc."
              />
            </Field>
          </div>
        </div>
        <div
          className="card-pad"
          style={{ paddingTop: 0, display: 'flex', justifyContent: 'flex-end', gap: 10 }}
        >
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onSave({ ...r, source: 'manual' })}
            disabled={!r.name}
          >
            Save response
          </button>
        </div>
      </div>
    </div>
  )
}

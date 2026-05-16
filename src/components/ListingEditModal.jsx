import React from 'react'
import { Icon, Field, Segment } from './ui.jsx'

// Edit modal for a single property. Edits go through properties:update,
// which strips undefined keys before patching — so blank inputs leave the
// stored value alone rather than wiping it. Status changes happen elsewhere
// (the per-card Advance/Reopen button → properties:advanceStatus), so this
// modal only edits the descriptive fields lifted from the poster.
export default function ListingEditModal({ property, onClose, onSave }) {
  const [f, setF] = React.useState({
    condo: property.condo || '',
    rentSGD: property.rentSGD ?? '',
    buildingType: property.buildingType || '',
    unitType: property.unitType || '',
    housingType: property.housingType || '',
    area: property.area || '',
    ageYears: property.ageYears ?? '',
    fullAddress: property.fullAddress || '',
    commuteNUS: property.commuteMins?.NUS ?? '',
    commuteNTU: property.commuteMins?.NTU ?? '',
    commuteSMU: property.commuteMins?.SMU ?? '',
  })
  const upd = (k, v) => setF((s) => ({ ...s, [k]: v }))
  const numOrUndef = (v) => {
    if (v === '' || v == null) return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  const strOrUndef = (v) => {
    const t = (v ?? '').toString().trim()
    return t.length ? t : undefined
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!f.condo.trim()) return
    const patch = {
      condo: f.condo.trim(),
      rentSGD: numOrUndef(f.rentSGD),
      buildingType:
        f.buildingType === 'Condo' || f.buildingType === 'HDB' ? f.buildingType : undefined,
      unitType: strOrUndef(f.unitType),
      housingType:
        f.housingType === 'Room' || f.housingType === 'Whole Unit' ? f.housingType : undefined,
      area: strOrUndef(f.area),
      ageYears: numOrUndef(f.ageYears),
      fullAddress: strOrUndef(f.fullAddress),
    }
    const nus = numOrUndef(f.commuteNUS)
    const ntu = numOrUndef(f.commuteNTU)
    const smu = numOrUndef(f.commuteSMU)
    if (nus != null && ntu != null && smu != null) {
      patch.commuteMins = { NUS: nus, NTU: ntu, SMU: smu }
    }
    onSave(patch)
  }

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
      <form
        className="card"
        style={{ width: 640, maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div
          className="card-head"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
        >
          <div>
            <h3 className="card-title">Edit listing</h3>
            <p className="card-sub">
              Leave a field blank to keep its stored value. Status is changed via the card buttons,
              not here.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="card-pad">
          <div className="form-grid">
            <Field label="Condo / HDB name" required span={12}>
              <input
                className="input"
                value={f.condo}
                onChange={(e) => upd('condo', e.target.value)}
                placeholder="e.g. Normanton Park"
              />
            </Field>

            <Field label="Rent (S$ / mo)" span={4}>
              <input
                className="input"
                inputMode="numeric"
                value={f.rentSGD}
                onChange={(e) => upd('rentSGD', e.target.value)}
                placeholder="e.g. 1800"
              />
            </Field>
            <Field label="Building type" span={4}>
              <select
                className="select"
                value={f.buildingType}
                onChange={(e) => upd('buildingType', e.target.value)}
              >
                <option value="">—</option>
                <option>Condo</option>
                <option>HDB</option>
              </select>
            </Field>
            <Field label="Age (yrs)" span={4}>
              <input
                className="input"
                inputMode="numeric"
                value={f.ageYears}
                onChange={(e) => upd('ageYears', e.target.value)}
                placeholder="e.g. 6"
              />
            </Field>

            <Field label="Room / unit type" span={6}>
              <input
                className="input"
                value={f.unitType}
                onChange={(e) => upd('unitType', e.target.value)}
                placeholder="e.g. 1 Bedroom / 1 Bathroom"
              />
            </Field>
            <Field label="Housing type" span={6}>
              <Segment
                options={['Room', 'Whole Unit']}
                value={f.housingType || 'Room'}
                onChange={(v) => upd('housingType', v)}
              />
            </Field>

            <Field label="Area" span={6}>
              <input
                className="input"
                value={f.area}
                onChange={(e) => upd('area', e.target.value)}
                placeholder="e.g. Kent Ridge"
              />
            </Field>
            <Field label="Full address" span={6}>
              <input
                className="input"
                value={f.fullAddress}
                onChange={(e) => upd('fullAddress', e.target.value)}
                placeholder="e.g. 1 Normanton Park, S119003"
              />
            </Field>

            <Field
              label="Commute (mins to NUS / NTU / SMU)"
              hint="All three needed for the recommend engine"
              span={12}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  inputMode="numeric"
                  value={f.commuteNUS}
                  onChange={(e) => upd('commuteNUS', e.target.value)}
                  placeholder="NUS"
                />
                <input
                  className="input"
                  inputMode="numeric"
                  value={f.commuteNTU}
                  onChange={(e) => upd('commuteNTU', e.target.value)}
                  placeholder="NTU"
                />
                <input
                  className="input"
                  inputMode="numeric"
                  value={f.commuteSMU}
                  onChange={(e) => upd('commuteSMU', e.target.value)}
                  placeholder="SMU"
                />
              </div>
            </Field>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save changes
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

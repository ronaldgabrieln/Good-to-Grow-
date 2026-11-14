import {
  CROPS,
  PRIORITY_KEYS,
  PRIORITY_LABELS,
  seasonOf,
  slotLabel,
  type FieldInput,
  type Priorities,
  type Scenario,
  type Slots,
} from '../engine'
import { fmt } from './format'

function NumberField(props: {
  label: string
  value: number
  step?: number
  min?: number
  max?: number
  unit?: string
  hint?: string
  onChange: (v: number) => void
}) {
  return (
    <label className="field">
      <span className="field-label">
        {props.label}
        {props.unit && <span className="unit"> ({props.unit})</span>}
      </span>
      <input
        type="number"
        value={props.value}
        step={props.step ?? 1}
        min={props.min}
        max={props.max}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (Number.isFinite(v)) props.onChange(v)
        }}
      />
      {props.hint && <span className="hint">{props.hint}</span>}
    </label>
  )
}

export function FieldPanel(props: {
  field: FieldInput
  onChange: (f: FieldInput) => void
  onChangeLocation: () => void
  status: string[]
}) {
  const { field, onChange } = props
  const set = <K extends keyof FieldInput>(k: K, v: FieldInput[K]) => onChange({ ...field, [k]: v })
  return (
    <section className="panel">
      <h2>1 · Your field</h2>
      <label className="field">
        <span className="field-label">Name</span>
        <input type="text" value={field.name} onChange={(e) => set('name', e.target.value)} />
      </label>
      <div className="location-row">
        <span className="small muted">
          Picked on the map · {field.lat.toFixed(3)}, {field.lon.toFixed(3)}
        </span>
        <button className="btn btn-quiet btn-inline" onClick={props.onChangeLocation}>
          Change field
        </button>
      </div>
      <ul className="status">
        {props.status.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <div className="grid2">
        <NumberField label="Elevation" unit="m" value={field.elevationM} onChange={(v) => set('elevationM', v)} />
        <NumberField label="Slope" unit="%" value={field.slopePct} step={0.5} min={0} max={40} onChange={(v) => set('slopePct', v)} />
        <NumberField label="Slope length" unit="m" value={field.slopeLengthM} step={10} min={10} onChange={(v) => set('slopeLengthM', v)} />
        <NumberField
          label="Well water salinity"
          unit="dS/m"
          value={field.wellEcDsM}
          step={0.1}
          min={0}
          max={8}
          onChange={(v) => set('wellEcDsM', v)}
        />
      </div>
      <label className="field">
        <span className="field-label">Irrigation system</span>
        <select value={field.irrigationEfficiency} onChange={(e) => set('irrigationEfficiency', parseFloat(e.target.value))}>
          <option value={0.9}>Drip (90 % efficient)</option>
          <option value={0.75}>Sprinkler (75 %)</option>
          <option value={0.6}>Furrow (60 %)</option>
        </select>
      </label>
    </section>
  )
}

export function RotationEditor(props: { slots: Slots; onChange: (s: Slots) => void; problems: string[] }) {
  const { slots, onChange } = props
  return (
    <section className="panel">
      <h2>2 · What you plant now</h2>
      <p className="muted small">Three years, two seasons each. Pick “nothing new” when the field is bare or a long crop is still growing.</p>
      <div className="rotation-grid">
        {slots.map((id, slot) => {
          const season = seasonOf(slot)
          const options = CROPS.filter((c) => c.plant[season] !== undefined)
          return (
            <label className="field" key={slot}>
              <span className="field-label">{slotLabel(slot)}</span>
              <select
                value={id ?? ''}
                onChange={(e) => {
                  const next = [...slots]
                  next[slot] = e.target.value || null
                  onChange(next)
                }}
              >
                <option value="">— nothing new planted —</option>
                {(['cash', 'forage', 'cover'] as const).map((kind) => (
                  <optgroup key={kind} label={kind === 'cash' ? 'Cash crops' : kind === 'forage' ? 'Forage' : 'Cover crops'}>
                    {options
                      .filter((c) => c.kind === kind)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.nameEs}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
          )
        })}
      </div>
      {props.problems.length > 0 && (
        <div className="notice">
          <strong>Agronomic issues in this rotation</strong>
          <ul>
            {props.problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          <span className="small">It is still scored as your baseline.</span>
        </div>
      )}
    </section>
  )
}

const LEVELS = ['Ignore', 'Low', 'Some', 'Medium', 'High', 'Top']

export function PriorityPanel(props: { priorities: Priorities; onChange: (p: Priorities) => void }) {
  return (
    <section className="panel">
      <h2>3 · What matters to you</h2>
      {PRIORITY_KEYS.map((k) => (
        <label className="slider" key={k}>
          <span className="slider-head">
            <span>{PRIORITY_LABELS[k]}</span>
            <span className="slider-value">{LEVELS[props.priorities[k]]}</span>
          </span>
          <input
            type="range"
            min={0}
            max={5}
            step={1}
            value={props.priorities[k]}
            onChange={(e) => props.onChange({ ...props.priorities, [k]: parseInt(e.target.value, 10) })}
          />
        </label>
      ))}
    </section>
  )
}

export function ScenarioPanel(props: { scenario: Scenario; onChange: (s: Scenario) => void }) {
  const { scenario, onChange } = props
  return (
    <section className="panel">
      <h2>4 · Test a changing climate</h2>
      <p className="muted small">Shifts all 30 years of weather, then replays every rotation again.</p>
      <label className="slider">
        <span className="slider-head">
          <span>Warmer</span>
          <span className="slider-value">+{fmt(scenario.deltaTempC, 1)} °C</span>
        </span>
        <input
          type="range"
          min={0}
          max={3}
          step={0.5}
          value={scenario.deltaTempC}
          onChange={(e) => onChange({ ...scenario, deltaTempC: parseFloat(e.target.value) })}
        />
      </label>
      <label className="slider">
        <span className="slider-head">
          <span>Rainfall change</span>
          <span className="slider-value">
            {scenario.rainChange > 0 ? '+' : ''}
            {fmt(scenario.rainChange * 100)} %
          </span>
        </span>
        <input
          type="range"
          min={-0.3}
          max={0.1}
          step={0.05}
          value={scenario.rainChange}
          onChange={(e) => onChange({ ...scenario, rainChange: parseFloat(e.target.value) })}
        />
      </label>
      {(scenario.deltaTempC !== 0 || scenario.rainChange !== 0) && (
        <button className="btn btn-quiet" onClick={() => onChange({ deltaTempC: 0, rainChange: 0 })}>
          Back to observed climate
        </button>
      )}
    </section>
  )
}

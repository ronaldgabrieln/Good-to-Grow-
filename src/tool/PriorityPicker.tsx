import { useState } from 'react'
import { DEFAULT_PRIORITIES, PRIORITY_KEYS, PRIORITY_LABELS, type Priorities } from '../engine'

const LEVELS = ['Ignore', 'Low', 'Some', 'Medium', 'High', 'Top']

/** "What matters to you?" — shown right after the crop question, before the analysis starts. */
export function PriorityPicker(props: { initial: Priorities; onDone: (p: Priorities) => void; onBack: () => void }) {
  const [priorities, setPriorities] = useState<Priorities>(props.initial)

  return (
    <div className="crops-backdrop" role="dialog" aria-modal="true" aria-labelledby="prio-title">
      <div className="crops-card prio-card">
        <h2 id="prio-title">What matters to you?</h2>
        {PRIORITY_KEYS.map((k) => (
          <label className="prio-slider" key={k}>
            <span className="prio-head">
              <span>{PRIORITY_LABELS[k]}</span>
              <span className="prio-value">{LEVELS[priorities[k]]}</span>
            </span>
            <input
              type="range"
              min={0}
              max={5}
              step={1}
              value={priorities[k]}
              onChange={(e) => setPriorities({ ...priorities, [k]: parseInt(e.target.value, 10) })}
            />
          </label>
        ))}
        <button
          type="button"
          className="prio-reset"
          onClick={() => setPriorities(DEFAULT_PRIORITIES)}
          disabled={PRIORITY_KEYS.every((k) => priorities[k] === DEFAULT_PRIORITIES[k])}
        >
          Use default settings
        </button>
        <div className="crops-actions">
          <button type="button" className="crops-back" onClick={props.onBack}>
            Back
          </button>
          <button type="button" className="crops-go" onClick={() => props.onDone(priorities)}>
            Analyze my farm
          </button>
        </div>
      </div>
    </div>
  )
}

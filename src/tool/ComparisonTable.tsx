import { PRIORITY_KEYS, PRIORITY_LABELS, type PriorityKey, type RotationMetrics, type Strategy } from '../engine'
import { fmt, TYPE_LABEL } from './format'

const RAW: Record<PriorityKey, { unit: string; get: (m: RotationMetrics) => string }> = {
  water: { unit: 'mm/yr irrigation', get: (m) => `${fmt(m.waterMm)} mm` },
  income: { unit: 'relative index/yr', get: (m) => fmt(m.income, 1) },
  soil: { unit: 't residue/ha/yr', get: (m) => `${fmt(m.residueT, 1)} t` },
  nitrogen: { unit: 'kg N/ha/yr bought', get: (m) => `${fmt(m.nitrogenKg)} kg` },
  erosion: { unit: 't soil/ha/yr', get: (m) => `${fmt(m.erosionT, 2)} t` },
  pest: { unit: 'break score /100', get: (m) => fmt(m.pestScore) },
  risk: { unit: 'cycles with a failed crop', get: (m) => `${fmt(m.failureRisk * 100)}%` },
}

/** Criteria × strategies. Doubles as the accessible table view of the scores. */
export function ComparisonTable({ strategies, weights }: { strategies: Strategy[]; weights: Record<PriorityKey, number> }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Side-by-side trade-offs</h2>
        <span className="muted small">Bars: 0–100 relative to all rotations the engine generated (longer = better for that goal).</span>
      </div>
      <div className="table-scroll">
        <table className="compare">
          <thead>
            <tr>
              <th>Goal</th>
              {strategies.map((s, i) => (
                <th key={i}>
                  {TYPE_LABEL[s.type]}
                  {s.rank > 0 && <span className="muted small"> · #{s.rank}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PRIORITY_KEYS.map((k) => {
              const best = Math.max(...strategies.map((s) => s.scores[k]))
              return (
                <tr key={k} className={weights[k] === 0 ? 'is-ignored' : ''}>
                  <th scope="row">
                    {PRIORITY_LABELS[k]}
                    <span className="muted small">{RAW[k].unit}</span>
                  </th>
                  {strategies.map((s, i) => (
                    <td key={i}>
                      <div className="cell">
                        <span className={`cell-value ${s.scores[k] === best && strategies.length > 1 ? 'is-best' : ''}`}>{RAW[k].get(s.metrics)}</span>
                        <span className="meter" aria-hidden>
                          <span style={{ width: `${Math.max(2, s.scores[k])}%` }} />
                        </span>
                      </div>
                    </td>
                  ))}
                </tr>
              )
            })}
            <tr className="total">
              <th scope="row">Overall fit to your priorities</th>
              {strategies.map((s, i) => (
                <td key={i}>
                  <strong>{fmt(s.total)}</strong>
                  <span className="muted small"> / 100</span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

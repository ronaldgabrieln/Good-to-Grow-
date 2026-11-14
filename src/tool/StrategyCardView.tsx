import { CROP_BY_ID, PRIORITY_LABELS, type Strategy } from '../engine'
import { Badge } from './ClimatePanel'
import { fmt, TYPE_LABEL } from './format'

function List({ items, empty }: { items: string[]; empty?: string }) {
  if (items.length === 0) return empty ? <p className="muted small">{empty}</p> : null
  return (
    <ul>
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  )
}

export function StrategyCardView({ s }: { s: Strategy }) {
  const c = s.card
  return (
    <article className={`strategy strategy-${s.type}`}>
      <header>
        <span className="type">{TYPE_LABEL[s.type]}</span>
        <h3>{c.headline}</h3>
        <ol className="sequence">
          {s.rotation.slots.map((id, i) => {
            const crop = id ? CROP_BY_ID[id] : null
            return (
              <li key={i} className={crop ? `chip chip-${crop.kind}` : 'chip chip-empty'} title={crop ? `${crop.name} · ${crop.nameEs}` : 'Nothing new planted'}>
                <span className="chip-slot">
                  Y{Math.floor(i / 2) + 1} {i % 2 === 0 ? 'spring' : 'fall'}
                </span>
                {crop ? crop.name.replace(/ \(.*\)$/, '') : '—'}
              </li>
            )
          })}
        </ol>
        <div className="score-line">
          <strong>{fmt(s.total)}</strong>/100 fit
          {c.bestAt.length > 0 && (
            <span className="best-at">Best here for: {c.bestAt.map((k) => PRIORITY_LABELS[k].toLowerCase()).join(', ')}</span>
          )}
        </div>
      </header>

      <h4>Why it was suggested</h4>
      <List items={c.why} />

      {c.benefits.length > 0 && (
        <>
          <h4>Benefits</h4>
          <List items={c.benefits} />
        </>
      )}
      {c.tradeoffs.length > 0 && (
        <>
          <h4>Trade-offs</h4>
          <List items={c.tradeoffs} />
        </>
      )}

      <h4>Risks to review locally</h4>
      <List items={c.risks} empty="No frost, heat or salinity problems showed up in the replayed years." />

      <details>
        <summary>Evidence ({c.evidence.length})</summary>
        <ul className="evidence">
          {c.evidence.map((e, i) => (
            <li key={i}>
              <Badge p={e.provenance} /> {e.text}
              <span className="source">{e.source}</span>
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Information gaps ({c.gaps.length})</summary>
        <List items={c.gaps} />
      </details>

      <p className="extension">{c.extension}</p>
    </article>
  )
}

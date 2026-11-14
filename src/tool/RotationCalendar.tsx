import { useState } from 'react'
import { CROP_BY_ID, type ClimateFeatures, type Strategy } from '../engine'
import { fmt, MONTHS, TYPE_LABEL } from './format'

const CYCLE = 365 * 3
const pctX = (day: number) => (day / CYCLE) * 100

interface Seg {
  start: number
  end: number
  kind: 'cash' | 'cover' | 'forage' | 'bare'
  label: string
  detail: string
}

function dateLabel(day: number) {
  const d = ((day % 365) + 365) % 365
  const date = new Date(Date.UTC(2001, 0, d + 1))
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()} (yr ${Math.floor(day / 365) % 3 + 1})`
}

/** Split a segment that runs past the end of the 3-year cycle into two drawable pieces. */
function wrap(seg: Seg): Seg[] {
  if (seg.end <= CYCLE) return [seg]
  return [
    { ...seg, end: CYCLE },
    { ...seg, start: 0, end: seg.end - CYCLE },
  ]
}

function segmentsOf(s: Strategy): Seg[] {
  const segs: Seg[] = []
  const wins = [...s.windows].sort((a, b) => a.startDay - b.startDay)
  wins.forEach((w, k) => {
    const c = CROP_BY_ID[w.cropId]
    const ev = s.events.find((e) => e.slot === w.slot)
    const risk = ev
      ? [
          ev.heatYears ? `heat stress ${ev.heatYears}/${ev.yearsReplayed} yrs` : '',
          ev.frostYears ? `frost ${ev.frostYears}/${ev.yearsReplayed} yrs` : '',
          `~${fmt(ev.meanIrrigationMm)} mm irrigation`,
        ]
          .filter(Boolean)
          .join(' · ')
      : ''
    segs.push(...wrap({ start: w.startDay, end: w.endDay, kind: c.kind, label: c.name.replace(/ \(.*\)$/, ''), detail: `${dateLabel(w.startDay)} → ${dateLabel(w.endDay)} · ${risk}` }))
    const next = wins[k + 1]
    const nextStart = next ? next.startDay : wins[0].startDay + CYCLE
    if (nextStart > w.endDay)
      segs.push(
        ...wrap({
          start: w.endDay,
          end: nextStart,
          kind: 'bare',
          label: '',
          detail: `Bare soil ${fmt(nextStart - w.endDay)} days: ${dateLabel(w.endDay)} → ${dateLabel(nextStart)}`,
        }),
      )
  })
  return segs
}

export function RotationCalendar({ strategies, features }: { strategies: Strategy[]; features: ClimateFeatures }) {
  const [tip, setTip] = useState<{ row: number; x: number; seg: Seg } | null>(null)
  const months = Array.from({ length: 36 }, (_, i) => i)
  const monthStart = (i: number) => Math.floor(i / 12) * 365 + [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][i % 12]
  const monthEnd = (i: number) => (i === 35 ? CYCLE : monthStart(i + 1))
  const rainy = (i: number) => (i % 12 >= 10 || i % 12 <= 2)
  const hot = (i: number) => features.monthly[i % 12].heatProb >= 0.15

  return (
    <section className="card">
      <div className="card-head">
        <h2>When is your field planted, bare, or at risk?</h2>
        <span className="muted small">3-year rotation calendar. Hover a bar for dates and replayed risks.</span>
      </div>
      <div className="legend">
        <span><i className="sw sw-cash" /> Cash crop</span>
        <span><i className="sw sw-cover" /> Cover crop</span>
        <span><i className="sw sw-forage" /> Forage</span>
        <span><i className="sw sw-bare" /> Bare soil</span>
        <span><i className="sw sw-rainy" /> Rainy season (Nov–Mar)</span>
        <span><i className="sw sw-hot" /> Months with ≥3 days ≥35 °C in ≥15% of years</span>
      </div>
      <div className="cal">
        <div className="cal-axis">
          {months.map((i) => (
            <span key={i} style={{ left: `${pctX(monthStart(i))}%`, width: `${pctX(monthEnd(i) - monthStart(i))}%` }} className={i % 12 === 0 ? 'cal-year' : ''}>
              {i % 12 === 0 ? `Year ${i / 12 + 1}` : i % 3 === 0 ? MONTHS[i % 12] : ''}
            </span>
          ))}
        </div>
        {strategies.map((s, row) => (
          <div className="cal-row" key={s.rotation.id + row}>
            <div className="cal-name">
              <strong>{TYPE_LABEL[s.type]}</strong>
              <span className="small muted">{s.rotation.label}</span>
            </div>
            <div className="cal-track" onMouseLeave={() => setTip(null)}>
              {months.map((i) => (
                <div
                  key={i}
                  className={`cal-bg ${rainy(i) ? 'is-rainy' : ''} ${hot(i) ? 'is-hot' : ''} ${i % 12 === 0 ? 'is-year' : ''}`}
                  style={{ left: `${pctX(monthStart(i))}%`, width: `${pctX(monthEnd(i) - monthStart(i))}%` }}
                />
              ))}
              {segmentsOf(s).map((seg, k) => {
                const width = pctX(seg.end - seg.start)
                const fits = seg.label && width > seg.label.length * 0.95 + 1.5
                return (
                  <div
                    key={k}
                    className={`cal-seg seg-${seg.kind}`}
                    style={{ left: `${pctX(seg.start)}%`, width: `${width}%` }}
                    onMouseEnter={() => setTip({ row, x: pctX((seg.start + seg.end) / 2), seg })}
                  >
                    {fits && <span>{seg.label}</span>}
                  </div>
                )
              })}
              {tip && tip.row === row && (
                <div className="cal-tip" style={{ left: `${Math.min(80, Math.max(10, tip.x))}%` }}>
                  <strong>{tip.seg.kind === 'bare' ? 'Bare soil' : tip.seg.label}</strong>
                  <div>{tip.seg.detail}</div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

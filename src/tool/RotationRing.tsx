import { useState, type CSSProperties, type KeyboardEvent } from 'react'
import { CROP_BY_ID, type Slots } from '../engine'

/**
 * The 3-year plan as a ring: six pieces (Y1 spring, Y1 fall, … Y3 fall) going clockwise from the
 * top. Each year has its own color (spring dark, fall light); the two seasons of a year sit close
 * together and a wider gap separates the years. Bare seasons are gray. Hover lights a piece up,
 * click/tap shows a little more about it in the middle.
 */

// Geometry in SVG user units, centered on (0, 0).
const R_OUT = 150
const R_IN = 100
const CORNER = 9 // rounded corners: drawn as a stroke of this half-width with round joins
const GAP_SAME_YEAR = 5
const GAP_NEW_YEAR = 20
const VIEW = 250 // half-width of the viewBox, leaves room for the outside labels

const YEAR_COLORS = [
  { spring: '#2f6b36', fall: '#9bc088' }, // green
  { spring: '#3e5181', fall: '#87a0c8' }, // blue
  { spring: '#e2901c', fall: '#fcc36d' }, // orange
]
const BARE = '#d8d4c9'
const KIND_LABEL = { cash: 'Cash crop', cover: 'Cover crop', forage: 'Forage' } as const

const short = (id: string) => CROP_BY_ID[id].name.replace(/ \(.*\)$/, '')
const deg = (d: number) => (d * Math.PI) / 180
/** Clockwise from the top. */
const pt = (r: number, a: number) => [r * Math.sin(a), -r * Math.cos(a)] as const

function segmentPath(a0: number, a1: number, gapBefore: number, gapAfter: number) {
  const ro = R_OUT - CORNER
  const ri = R_IN + CORNER
  // Offset each edge by a fixed distance so the gaps have parallel sides, like the reference.
  const d0 = gapBefore / 2 + CORNER
  const d1 = gapAfter / 2 + CORNER
  const [x1, y1] = pt(ro, a0 + Math.asin(d0 / ro))
  const [x2, y2] = pt(ro, a1 - Math.asin(d1 / ro))
  const [x3, y3] = pt(ri, a1 - Math.asin(d1 / ri))
  const [x4, y4] = pt(ri, a0 + Math.asin(d0 / ri))
  return `M${x1} ${y1}A${ro} ${ro} 0 0 1 ${x2} ${y2}L${x3} ${y3}A${ri} ${ri} 0 0 0 ${x4} ${y4}Z`
}

/** Splits long crop names over two lines so they fit inside a piece. */
function nameLines(name: string): string[] {
  if (name.length <= 10) return [name]
  const words = name.split(/[\s/]+/).filter(Boolean)
  if (words.length < 2) return [name.slice(0, 9) + '…']
  const half = Math.ceil(words.length / 2)
  return [words.slice(0, half).join(' '), words.slice(half).join(' ')]
}

function plantDate(doy: number) {
  return new Date(Date.UTC(2021, 0, doy)).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function RotationRing(props: { slots: Slots; current?: Slots }) {
  const { slots, current } = props
  const [hover, setHover] = useState<number | null>(null)
  const [active, setActive] = useState<number | null>(null)
  const lit = hover ?? active
  const n = slots.length
  const step = 360 / n

  const toggle = (i: number) => setActive((a) => (a === i ? null : i))
  const onKey = (i: number) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle(i)
    }
  }

  return (
    <div className="ring">
      <svg
        className={`ring-svg ${lit !== null ? 'has-lit' : ''}`}
        viewBox={`${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}`}
        role="group"
        aria-label="Three-year plan: spring and fall of each year"
      >
        {slots.map((id, i) => {
          const year = Math.floor(i / 2)
          const spring = i % 2 === 0
          const colors = YEAR_COLORS[year % YEAR_COLORS.length]
          const fill = id ? (spring ? colors.spring : colors.fall) : BARE
          const darkFill = id && (spring ? year !== 2 : false)
          const a0 = deg(i * step)
          const a1 = deg((i + 1) * step)
          const mid = (a0 + a1) / 2
          const gapBefore = spring ? GAP_NEW_YEAR : GAP_SAME_YEAR
          const gapAfter = spring ? GAP_SAME_YEAR : GAP_NEW_YEAR
          const [nx, ny] = pt(1, mid)
          const [tx, ty] = pt((R_OUT + R_IN) / 2, mid)
          const [lx, ly] = pt(R_OUT + 16, mid)
          const anchor = nx > 0.2 ? 'start' : nx < -0.2 ? 'end' : 'middle'
          const lines = id ? nameLines(short(id)) : ['bare']
          const season = spring ? 'spring' : 'fall'
          return (
            <g
              key={i}
              className={`ring-seg ${lit === i ? 'is-lit' : ''} ${active === i ? 'is-active' : ''} ${id ? '' : 'is-bare'}`}
              style={{ '--dx': `${nx * 7}px`, '--dy': `${ny * 7}px` } as CSSProperties}
              role="button"
              tabIndex={0}
              aria-pressed={active === i}
              aria-label={`Year ${year + 1} ${season}: ${id ? short(id) : 'nothing planted'}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => toggle(i)}
              onKeyDown={onKey(i)}
            >
              <path d={segmentPath(a0, a1, gapBefore, gapAfter)} fill={fill} stroke={fill} strokeWidth={CORNER * 2} strokeLinejoin="round" />
              <text
                x={tx}
                y={ty - (lines.length - 1) * 7}
                className={`ring-name ${darkFill ? 'on-dark' : ''}`}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {lines.map((l, k) => (
                  <tspan key={k} x={tx} dy={k === 0 ? 0 : 14}>
                    {l}
                  </tspan>
                ))}
              </text>
              <text x={lx} y={ly} className="ring-label" textAnchor={anchor} dominantBaseline="central">
                <tspan className="ring-season">{season}</tspan>
                <tspan className="ring-year" dx={5} fill={colors.spring}>
                  Y{year + 1}
                </tspan>
              </text>
            </g>
          )
        })}
      </svg>
      <div className="ring-center" aria-live="polite">
        {lit === null ? (
          <>
            <strong>3 years</strong>
            <span>Tap a piece to see more</span>
          </>
        ) : (
          <RingInfo slot={lit} id={slots[lit]} before={current?.[lit] ?? null} showChange={!!current} />
        )}
      </div>
    </div>
  )
}

function RingInfo(props: { slot: number; id: string | null; before: string | null; showChange: boolean }) {
  const { slot, id, before } = props
  const when = `Year ${Math.floor(slot / 2) + 1} · ${slot % 2 === 0 ? 'Spring' : 'Fall'}`
  const change = !props.showChange
    ? null
    : before === id
      ? 'Same as now'
      : before
        ? `Instead of ${short(before)}`
        : 'New: field was bare'
  if (!id) {
    return (
      <>
        <span className="ring-when">{when}</span>
        <strong>Rest</strong>
        <span>Nothing new planted</span>
        {change && <em>{change}</em>}
      </>
    )
  }
  const c = CROP_BY_ID[id]
  const doy = c.plant[slot % 2 === 0 ? 'A' : 'B']
  const months = Math.round((c.stages.reduce((a, b) => a + b, 0) / 30) * 2) / 2
  return (
    <>
      <span className="ring-when">{when}</span>
      <strong>{short(id)}</strong>
      <span>
        {c.nameEs} · {KIND_LABEL[c.kind]}
      </span>
      <span>
        {doy !== undefined ? `Plant ~${plantDate(doy)} · ` : ''}
        {months} months
      </span>
      {c.nCreditKg > 0 && <span>Feeds the soil nitrogen</span>}
      {change && <em>{change}</em>}
    </>
  )
}

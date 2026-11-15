import { useState, type CSSProperties, type KeyboardEvent } from 'react'
import { CROP_BY_ID, type Slots } from '../engine'
import centerText from '../assets/Hello (6).svg'

/**
 * The 3-year plan as a ring: six pieces (Y1 spring, Y1 fall, … Y3 fall) going clockwise from the
 * top. Each year is drawn as one arrow: it starts with a notch and ends with a point that fits into
 * the next year's notch. Inside a year, spring and fall are split by a thin line. Every season has
 * its own color, which its outside label shares. Bare seasons are gray. Hover lights a piece up,
 * click/tap shows a little more about it in the middle.
 */

// Geometry in SVG user units, centered on (0, 0).
const R_OUT = 150
const R_IN = 92
const R_MID = (R_OUT + R_IN) / 2
const GAP_NEW_YEAR = 8 // gap around each arrow point
const GAP_SAME_YEAR = 2.5 // thin line between spring and fall
const TIP = 20 // how far the arrow point reaches into the next year (along the middle of the ring)
const VIEW = 250 // half-width of the viewBox, leaves room for the outside labels

const YEARS = [
  { year: '#753646', spring: '#a0718d', fall: '#7b4e59' },
  { year: '#9bbc74', spring: '#b8d793', fall: '#80a752' },
  { year: '#6a99a3', spring: '#b4dce5', fall: '#82aeb7' },
]
const BARE = '#d8d4c9'
const KIND_LABEL = { cash: 'Cash crop', cover: 'Cover crop', forage: 'Forage' } as const

const short = (id: string) => CROP_BY_ID[id].name.replace(/ \(.*\)$/, '')
const deg = (d: number) => (d * Math.PI) / 180
/** Clockwise from the top. */
const pt = (r: number, a: number) => [r * Math.sin(a), -r * Math.cos(a)] as const
/** Angle that covers `d` units of arc at radius `r` (keeps gaps the same width across the ring). */
const along = (d: number, r: number) => d / r

/** Light fills get navy crop names, dark fills white ones. */
function isLight(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.3
}

/**
 * One piece of the ring between angles a0 and a1.
 * notchStart: the piece starts a year, so its start edge is a notch (the previous arrow's point
 * fits in it). tipEnd: the piece ends a year, so its end edge is an arrow point.
 */
function segmentPath(a0: number, a1: number, notchStart: boolean, tipEnd: boolean) {
  const g0 = (notchStart ? GAP_NEW_YEAR : GAP_SAME_YEAR) / 2
  const g1 = (tipEnd ? GAP_NEW_YEAR : GAP_SAME_YEAR) / 2
  const [ox0, oy0] = pt(R_OUT, a0 + along(g0, R_OUT))
  const [ox1, oy1] = pt(R_OUT, a1 - along(g1, R_OUT))
  const [ix1, iy1] = pt(R_IN, a1 - along(g1, R_IN))
  const [ix0, iy0] = pt(R_IN, a0 + along(g0, R_IN))
  const end = tipEnd ? (() => { const [x, y] = pt(R_MID, a1 + along(TIP - g1, R_MID)); return `L${x} ${y}` })() : ''
  const start = notchStart ? (() => { const [x, y] = pt(R_MID, a0 + along(TIP + g0, R_MID)); return `L${x} ${y}` })() : ''
  return (
    `M${ox0} ${oy0}A${R_OUT} ${R_OUT} 0 0 1 ${ox1} ${oy1}` +
    `${end}L${ix1} ${iy1}A${R_IN} ${R_IN} 0 0 0 ${ix0} ${iy0}${start}Z`
  )
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
  const years = Math.ceil(n / 2)

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
          const colors = YEARS[year % YEARS.length]
          const seasonColor = spring ? colors.spring : colors.fall
          const fill = id ? seasonColor : BARE
          const a0 = deg(i * step)
          const a1 = deg((i + 1) * step)
          const mid = (a0 + a1) / 2
          const midDeg = (i + 0.5) * step
          const [nx, ny] = pt(1, mid)
          const [tx, ty] = pt(R_MID, mid + (spring ? along(TIP / 2, R_MID) : 0))
          // Season label follows the curve; flipped on the lower half so it never reads upside down.
          const [lx, ly] = pt(R_OUT + 15, mid)
          const labelRot = midDeg > 90 && midDeg < 270 ? midDeg + 180 : midDeg
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
              <path d={segmentPath(a0, a1, spring, !spring || i === n - 1)} fill={fill} />
              <text
                x={tx}
                y={ty - (lines.length - 1) * 7}
                className={`ring-name ${id && !isLight(fill) ? 'on-dark' : ''}`}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {lines.map((l, k) => (
                  <tspan key={k} x={tx} dy={k === 0 ? 0 : 14}>
                    {l}
                  </tspan>
                ))}
              </text>
              <text
                className="ring-season"
                x={lx}
                y={ly}
                fill={seasonColor}
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${labelRot} ${lx} ${ly})`}
              >
                {spring ? 'Spring' : 'Fall'}
              </text>
            </g>
          )
        })}
        {/* Year labels sit outside the ring, between each year's spring and fall. */}
        {Array.from({ length: years }, (_, y) => {
          const [x, yy] = pt(R_OUT + 44, deg((y * 2 + 1) * step))
          return (
            <text
              key={y}
              className="ring-year"
              x={x}
              y={yy}
              fill={YEARS[y % YEARS.length].year}
              textAnchor="middle"
              dominantBaseline="central"
            >
              Year {y + 1}
            </text>
          )
        })}
      </svg>
      <div className="ring-center" aria-live="polite">
        {lit === null ? (
          <img className="ring-center-img" src={centerText} alt="3 years. Tap a piece to see more" />
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

// Small SVG charts for the behind-the-scenes view: lines + bars on one axis, grouped bars, scatter.
// One y-axis per chart; hover (or tap) shows a tooltip. Colors come from lab.css tokens.
import { useState, type ReactNode, type PointerEvent as RPointerEvent } from 'react'
import { fmt, ticks, useWidth } from './chartUtils'

const lin = (d0: number, d1: number, r0: number, r1: number) => (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0)

export interface TipRow { color: string; name: string; value: string }
export interface Tip { x: number; y: number; title: string; rows: TipRow[] }

export function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  const left = Math.min(tip.x + 14, window.innerWidth - 270)
  const top = tip.y + 14 + 160 > window.innerHeight ? tip.y - 150 : tip.y + 14
  return (
    <div className="lab-tip" style={{ left: Math.max(8, left), top: Math.max(8, top) }}>
      <div className="lab-tip-t">{tip.title}</div>
      {tip.rows.map((r) => (
        <div className="lab-tip-r" key={r.name}>
          <span><i className="lab-sw" style={{ background: r.color }} /> {r.name}</span>
          <span>{r.value}</span>
        </div>
      ))}
    </div>
  )
}

function Grid({ y, yTicks, l, r, yFmt }: { y: (v: number) => number; yTicks: number[]; l: number; r: number; yFmt: (v: number) => string }) {
  return (
    <g>
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={l} x2={r} y1={y(t)} y2={y(t)} className="lab-grid" />
          <text x={l - 8} y={y(t) + 4} textAnchor="end">{yFmt(t)}</text>
        </g>
      ))}
    </g>
  )
}

export interface Series { name: string; values: ArrayLike<number>; color: string; dash?: boolean }

/** Line series plus optional bars, all on one y-axis, with a crosshair tooltip. */
export function LineChart(props: {
  xs: number[]
  series: Series[]
  bars?: Series
  height?: number
  yMin?: number
  yMax?: number
  xTicks?: number[]
  xFmt?: (v: number) => string
  tipTitle: (i: number) => string
  unit?: string
  digits?: number
  marks?: { x: number; label: string }[]
  label: string
  /** Called with the index under the pointer on click/tap. */
  onPick?: (i: number) => void
  /** Index to mark with a ring (e.g. the selected year). */
  selected?: number
}) {
  const { xs, series, bars, height = 200, xTicks = [], xFmt = String, tipTitle, unit = '', digits = 1, marks = [], onPick, selected } = props
  const [ref, W] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<{ i: number; tip: Tip } | null>(null)
  const m = { t: 12, r: 12, b: 26, l: 46 }
  let max = -Infinity
  let min = Infinity
  for (const s of [...series, ...(bars ? [bars] : [])]) for (let i = 0; i < s.values.length; i++) { max = Math.max(max, s.values[i]); min = Math.min(min, s.values[i]) }
  const y0 = props.yMin ?? Math.min(0, min)
  const y1 = props.yMax ?? (max > y0 ? max * 1.08 : y0 + 1)
  const x = lin(xs[0], xs[xs.length - 1], m.l, W - m.r)
  const y = lin(y0, y1, height - m.b, m.t)
  const bw = Math.max(1.2, ((W - m.l - m.r) / xs.length) * 0.7)
  const onMove = (e: RPointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    let i = 0
    let best = Infinity
    for (let k = 0; k < xs.length; k++) { const d = Math.abs(x(xs[k]) - px); if (d < best) { best = d; i = k } }
    const rows = [...series, ...(bars ? [bars] : [])].map((s) => ({ color: s.color, name: s.name, value: fmt(s.values[i], digits) + unit }))
    setHover({ i, tip: { x: e.clientX, y: e.clientY, title: tipTitle(i), rows } })
    if (e.type === 'pointerdown') onPick?.(i)
  }
  return (
    <div ref={ref} className="lab-chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={props.label}>
        <Grid y={y} yTicks={ticks(y0, y1, height < 170 ? 3 : 4)} l={m.l} r={W - m.r} yFmt={(v) => fmt(v)} />
        {xTicks.map((t) => <text key={t} x={x(t)} y={height - 6} textAnchor="middle">{xFmt(t)}</text>)}
        {marks.map((mk) => (
          <g key={mk.label}>
            <line x1={x(mk.x)} x2={x(mk.x)} y1={m.t} y2={height - m.b} className="lab-mark" />
            <text x={x(mk.x) + 4} y={m.t + 10}>{mk.label}</text>
          </g>
        ))}
        {bars && xs.map((xv, i) => bars.values[i] > 0 && (
          <rect key={i} x={x(xv) - bw / 2} y={y(bars.values[i])} width={bw} height={Math.max(0.5, y(y0 > 0 ? y0 : 0) - y(bars.values[i]))} rx={Math.min(2, bw / 2)} style={{ fill: bars.color }} />
        ))}
        {series.map((s) => {
          let d = ''
          for (let i = 0; i < xs.length; i++) d += (i ? 'L' : 'M') + x(xs[i]).toFixed(1) + ',' + y(s.values[i]).toFixed(1)
          return <path key={s.name} d={d} fill="none" strokeWidth={2} strokeLinejoin="round" strokeDasharray={s.dash ? '6 4' : undefined} style={{ stroke: s.color }} />
        })}
        {selected !== undefined && selected >= 0 && series[0] && (
          <circle cx={x(xs[selected])} cy={y(series[0].values[selected])} r={7} fill="none" strokeWidth={2.5} style={{ stroke: 'var(--text)' }} />
        )}
        {hover && (
          <g>
            <line x1={x(xs[hover.i])} x2={x(xs[hover.i])} y1={m.t} y2={height - m.b} className="lab-cross" />
            {series.map((s) => <circle key={s.name} cx={x(xs[hover.i])} cy={y(s.values[hover.i])} r={4} strokeWidth={2} style={{ fill: s.color, stroke: 'var(--surface)' }} />)}
          </g>
        )}
        <rect x={m.l} y={m.t} width={Math.max(0, W - m.l - m.r)} height={height - m.t - m.b} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      <Tooltip tip={hover?.tip ?? null} />
    </div>
  )
}

/** Grouped vertical bars over categories. `colorOf` overrides the color per category (single series). */
export function BarChart(props: {
  cats: string[]
  series: Series[]
  height?: number
  colorOf?: (i: number) => string
  tipTitle: (i: number) => string
  unit?: string
  refLine?: { value: number; label: string }
  label: string
}) {
  const { cats, series, height = 200, colorOf, tipTitle, unit = '', refLine } = props
  const [ref, W] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const m = { t: 12, r: 12, b: 26, l: 46 }
  let max = 0
  for (const s of series) for (let i = 0; i < s.values.length; i++) max = Math.max(max, s.values[i])
  if (refLine) max = Math.max(max, refLine.value)
  const yMax = max * 1.1 || 1
  const y = lin(0, yMax, height - m.b, m.t)
  const iw = W - m.l - m.r
  const step = iw / cats.length
  const gw = step * 0.8
  const bw = gw / series.length
  const every = Math.ceil(cats.length / Math.max(4, Math.floor(iw / 46)))
  return (
    <div ref={ref} className="lab-chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={props.label}>
        <Grid y={y} yTicks={ticks(0, yMax, 4)} l={m.l} r={W - m.r} yFmt={(v) => fmt(v)} />
        {cats.map((c, i) => {
          const x0 = m.l + i * step + (step - gw) / 2
          return (
            <g key={c}>
              {i % every === 0 && <text x={m.l + i * step + step / 2} y={height - 6} textAnchor="middle">{c}</text>}
              {series.map((s, k) => (
                <rect key={s.name} x={x0 + k * bw + 1} y={y(s.values[i])} width={Math.max(1, bw - 2)} height={Math.max(0.5, y(0) - y(s.values[i]))} rx={Math.min(4, bw / 3)} style={{ fill: colorOf ? colorOf(i) : s.color }} />
              ))}
              <rect
                x={m.l + i * step} y={m.t} width={step} height={height - m.t - m.b} fill="transparent"
                onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, title: tipTitle(i), rows: series.map((s) => ({ color: colorOf ? colorOf(i) : s.color, name: s.name, value: fmt(s.values[i]) + unit })) })}
                onPointerDown={(e) => setTip({ x: e.clientX, y: e.clientY, title: tipTitle(i), rows: series.map((s) => ({ color: colorOf ? colorOf(i) : s.color, name: s.name, value: fmt(s.values[i]) + unit })) })}
                onPointerLeave={() => setTip(null)}
              />
            </g>
          )
        })}
        {refLine && (
          <g>
            <line x1={m.l} x2={W - m.r} y1={y(refLine.value)} y2={y(refLine.value)} strokeDasharray="6 4" className="lab-ref" />
            <text x={W - m.r} y={y(refLine.value) - 5} textAnchor="end" className="lab-ref-t">{refLine.label}</text>
          </g>
        )}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

/** Water (x) vs income (y) for every scored rotation, colored by total score in 5 bins. */
export function PoolScatter(props: {
  points: Float32Array
  highlights: { water: number; income: number; label: string }[]
  label: string
  footer?: ReactNode
}) {
  const { points, highlights } = props
  const [ref, W] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const [hi, setHi] = useState(-1)
  const H = 340
  const m = { t: 18, r: 14, b: 30, l: 46 }
  const n = points.length / 4
  let xMax = 0, yMax = 0, tMin = Infinity, tMax = -Infinity
  for (let i = 0; i < n; i++) {
    xMax = Math.max(xMax, points[i * 4]); yMax = Math.max(yMax, points[i * 4 + 1])
    tMin = Math.min(tMin, points[i * 4 + 2]); tMax = Math.max(tMax, points[i * 4 + 2])
  }
  xMax *= 1.05; yMax *= 1.1
  const x = lin(0, xMax || 1, m.l, W - m.r)
  const y = lin(0, yMax || 1, H - m.b, m.t)
  const bin = (t: number) => Math.min(4, Math.floor(((t - tMin) / (tMax - tMin || 1)) * 5))
  const COL = ['var(--q1)', 'var(--q2)', 'var(--q3)', 'var(--q4)', 'var(--q5)']
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => points[a * 4 + 2] - points[b * 4 + 2])
  const onMove = (e: RPointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const py = ((e.clientY - r.top) / r.height) * H
    let bi = -1, bd = 300
    for (let i = 0; i < n; i++) { const d = (x(points[i * 4]) - px) ** 2 + (y(points[i * 4 + 1]) - py) ** 2; if (d < bd) { bd = d; bi = i } }
    setHi(bi)
    if (bi < 0) return setTip(null)
    setTip({
      x: e.clientX, y: e.clientY,
      title: bi === 0 ? 'Your current rotation' : points[bi * 4 + 3] ? 'Found by the beam search' : 'A 1–2 slot tweak of today’s rotation',
      rows: [
        { color: COL[bin(points[bi * 4 + 2])], name: 'Total score', value: fmt(points[bi * 4 + 2], 1) },
        { color: 'var(--text-3)', name: 'Irrigation', value: fmt(points[bi * 4]) + ' mm/yr' },
        { color: 'var(--text-3)', name: 'Income index', value: fmt(points[bi * 4 + 1], 2) },
      ],
    })
  }
  return (
    <div ref={ref} className="lab-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.label}>
        <Grid y={y} yTicks={ticks(0, yMax, 4)} l={m.l} r={W - m.r} yFmt={(v) => fmt(v)} />
        {ticks(0, xMax, 5).map((t) => <text key={t} x={x(t)} y={H - 8} textAnchor="middle">{fmt(t)}{t ? ' mm' : ''}</text>)}
        <text x={m.l} y={10}>Income index ↑</text>
        {order.map((i) => <circle key={i} cx={x(points[i * 4])} cy={y(points[i * 4 + 1])} r={2.6} style={{ fill: COL[bin(points[i * 4 + 2])] }} opacity={0.85} />)}
        {highlights.map((h) => {
          const right = x(h.water) < W * 0.62
          return (
            <g key={h.label}>
              <circle cx={x(h.water)} cy={y(h.income)} r={8} fill="none" strokeWidth={2.5} style={{ stroke: 'var(--text)' }} />
              <text x={x(h.water) + (right ? 12 : -12)} y={y(h.income) + 4} textAnchor={right ? 'start' : 'end'} className="lab-strong">{h.label}</text>
            </g>
          )
        })}
        {hi >= 0 && <circle cx={x(points[hi * 4])} cy={y(points[hi * 4 + 1])} r={6} fill="none" strokeWidth={2} style={{ stroke: 'var(--text)' }} />}
        <rect x={m.l} y={m.t} width={Math.max(0, W - m.l - m.r)} height={H - m.t - m.b} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => { setTip(null); setHi(-1) }} />
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

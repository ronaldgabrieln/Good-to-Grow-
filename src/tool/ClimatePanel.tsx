import { useState } from 'react'
import type { ClimateFeatures, EngineResult, Provenance } from '../engine'
import { fmt, MONTHS, PROVENANCE_HINT } from './format'

export function Badge({ p }: { p: Provenance }) {
  return (
    <span className={`badge badge-${p}`} title={PROVENANCE_HINT[p]}>
      {p}
    </span>
  )
}

function Tile(props: { label: string; value: string; sub?: string; p: Provenance; capitalize?: boolean }) {
  return (
    <div className="tile">
      <div className="tile-label">
        {props.label} <Badge p={props.p} />
      </div>
      <div className={`tile-value ${props.capitalize ? 'cap' : ''}`}>{props.value}</div>
      {props.sub && <div className="tile-sub">{props.sub}</div>}
    </div>
  )
}

/** Monthly rain (columns) vs reference ET₀ (line) — same unit, one axis. */
function MonthlyChart({ f }: { f: ClimateFeatures }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640
  const H = 220
  const m = { l: 40, r: 12, t: 12, b: 26 }
  const iw = W - m.l - m.r
  const ih = H - m.t - m.b
  const maxV = Math.max(...f.monthly.map((x) => Math.max(x.rainMeanMm, x.et0MeanMm)))
  const top = Math.ceil(maxV / 50) * 50
  const y = (v: number) => m.t + ih - (v / top) * ih
  const band = iw / 12
  const x = (i: number) => m.l + band * i + band / 2
  const barW = Math.min(24, band * 0.5)
  const ticks = Array.from({ length: top / 50 + 1 }, (_, i) => i * 50)
  const linePath = f.monthly.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.et0MeanMm)}`).join(' ')
  const h = hover !== null ? f.monthly[hover] : null
  return (
    <div className="chart-wrap">
      <div className="legend">
        <span>
          <i className="sw sw-rain" /> Rain (mean)
        </span>
        <span>
          <i className="sw sw-et0" /> Crop water demand, ET₀ (mean)
        </span>
        <span>mm per month</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Monthly rainfall versus reference evapotranspiration">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={m.l - 6} y={y(t) + 4} className="axis" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {f.monthly.map((d, i) => {
          const h0 = y(0) - y(d.rainMeanMm)
          const r = Math.min(4, h0)
          const bx = x(i) - barW / 2
          const by = y(d.rainMeanMm)
          return (
            <g key={i}>
              {h0 > 0.5 && (
                <path
                  className="bar-rain"
                  d={`M${bx},${y(0)} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + barW - r} Q${bx + barW},${by} ${bx + barW},${by + r} V${y(0)} Z`}
                />
              )}
              <text x={x(i)} y={H - 8} className="axis" textAnchor="middle">
                {MONTHS[i]}
              </text>
            </g>
          )
        })}
        <path d={linePath} className="line-et0" />
        {f.monthly.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.et0MeanMm)} r={hover === i ? 5 : 4} className="dot-et0" />
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={y(0)} className="crosshair" />}
        {f.monthly.map((_, i) => (
          <rect
            key={i}
            x={m.l + band * i}
            y={m.t}
            width={band}
            height={ih}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: `${(x(hover!) / W) * 100}%` }}>
          <strong>{MONTHS[hover!]}</strong>
          <div>Rain {fmt(h.rainMeanMm)} mm · ET₀ {fmt(h.et0MeanMm)} mm</div>
          <div>
            Highs {fmt(h.tmaxMean, 1)} °C · lows {fmt(h.tminMean, 1)} °C
          </div>
          <div>
            Frost in {fmt(h.frostProb * 100)}% of years · {fmt(h.heatDays, 1)} days ≥ 35 °C
          </div>
        </div>
      )}
    </div>
  )
}

export function ClimatePanel({ result }: { result: EngineResult }) {
  const f = result.features
  const s = result.soil
  const frostLine = f.lastFrostAfter.find((x) => x.years > 0)
  return (
    <section className="card">
      <div className="card-head">
        <h2>Your field’s last {f.nYears} years</h2>
        <span className="muted small">
          NASA POWER daily, {f.firstYear}–{f.lastYear} · {result.weather.lat.toFixed(2)}, {result.weather.lon.toFixed(2)} ·{' '}
          {result.weather.source === 'demo' ? 'bundled demo data' : result.weather.source === 'cache' ? 'cached download' : 'live'}
        </span>
      </div>
      <div className="tiles">
        <Tile label="Rain per year" value={`${fmt(f.rainMedianMm)} mm`} sub={`dry years ${fmt(f.rainP10Mm)} · wet years ${fmt(f.rainP90Mm)}`} p="observed" />
        <Tile label="Crop water demand" value={`${fmt(f.et0AnnualMm)} mm`} sub={`rain covers ${fmt(f.aridityIndex * 100)}% of it`} p="modeled" />
        <Tile label="Rainy season" value={`${fmt(f.rainySeasonShare * 100)}%`} sub="of rain falls Nov–Mar" p="observed" />
        <Tile label="Very dry years" value={`${f.dryYears} of ${f.hydroYears.length}`} sub="under 60% of median rain" p="observed" />
        <Tile label="Hot days ≥ 35 °C" value={`${fmt(f.heatDaysMedian)} / yr`} sub="median" p="observed" />
        <Tile
          label="Frost (≤ 0 °C)"
          value={`${f.frostYears} of ${f.nYears} yrs`}
          sub={frostLine ? `after ${frostLine.date} in ${frostLine.years} yrs` : 'no spring frosts'}
          p="observed"
        />
        <Tile capitalize label="Soil" value={s.textureClass} sub={`${fmt(s.awcMmPerM)} mm water/m · SOC ${fmt(s.socGkg, 1)} g/kg`} p="modeled" />
      </div>
      <MonthlyChart f={f} />
      {(result.weather.cells.length > 1 || result.weather.rainFlags.length > 0) && (
        <div className="data-notes small">
          <strong>Data handling</strong>
          <ul>
            {result.weather.cells.length > 1 && (
              <li>
                Your field sits on the edge between {result.weather.cells.length} NASA POWER grid cells (
                {result.weather.cells.map((c) => `${fmt(c.elevationM)} m`).join(' and ')} elevation), so they are averaged.
              </li>
            )}
            {result.weather.rainFlags.map((fl) => (
              <li key={fl.start}>
                Removed an implausible {fmt(fl.totalMm)} mm rain spell ({fl.start} → {fl.end}, peak {fmt(fl.peakMm)} mm in one day) from
                the NASA POWER record before replaying rotations.
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

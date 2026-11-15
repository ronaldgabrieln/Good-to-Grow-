import { useEffect, useState } from 'react'
import type { EngineResult } from '../engine'
import { clock, NODE_CALIBRATION, parseNodeCsv, summarizeGround, type GroundSummary } from '../engine/ground'
import { Badge } from './ClimatePanel'
import { fmt } from './format'

const BUNDLED = { url: `${import.meta.env.BASE_URL}data/ground/node-2026-11-15.csv`, label: 'night of 14–15 Nov 2026' }
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function Tile(props: { label: string; value: string; sub?: string; p: 'observed' | 'modeled' | 'assumed' }) {
  return (
    <div className="tile">
      <div className="tile-label">
        {props.label} <Badge p={props.p} />
      </div>
      <div className="tile-value">{props.value}</div>
      {props.sub && <div className="tile-sub">{props.sub}</div>}
    </div>
  )
}

/** Soil probe reading over time, with the fitted drainage curve and the field-capacity level it approaches. */
function DrainageChart({ g }: { g: GroundSummary }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640
  const H = 220
  const m = { l: 40, r: 12, t: 12, b: 26 }
  const iw = W - m.l - m.r
  const ih = H - m.t - m.b
  const fc = g.fit?.fcRaw
  const lo = Math.floor((Math.min(g.rawMin, fc ?? Infinity) - 10) / 20) * 20
  const hi = Math.ceil((Math.max(g.rawMax, NODE_CALIBRATION.wet) + 5) / 20) * 20
  const x = (t: number) => m.l + ((t - g.startMs) / (g.endMs - g.startMs)) * iw
  const y = (v: number) => m.t + ih - ((v - lo) / (hi - lo)) * ih
  const ticks = Array.from({ length: (hi - lo) / 20 + 1 }, (_, i) => lo + i * 20).filter((_, i, a) => a.length < 8 || i % 2 === 0)
  const hours = g.hourly.map((h) => h.hourMs).filter((t) => t >= g.startMs)
  const data = g.series.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.raw).toFixed(1)}`).join(' ')
  const fit = g.fit
  const fitPath = fit
    ? Array.from({ length: 60 }, (_, i) => {
        const t = fit.t0 + ((g.endMs - fit.t0) * i) / 59
        return `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(fit.fcRaw + fit.b * Math.exp(-(t - fit.t0) / 3.6e6 / fit.tauH)).toFixed(1)}`
      }).join(' ')
    : ''
  const h = hover !== null ? g.series[hover] : null
  return (
    <div className="chart-wrap">
      <div className="legend">
        <span>
          <i className="sw sw-rain" /> Soil probe reading (1-minute mean)
        </span>
        {fit && (
          <span>
            <i className="sw sw-et0" /> Drainage curve fitted to it
          </span>
        )}
        <span>raw probe units: higher = wetter</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart"
        role="img"
        aria-label="Soil probe reading over the night, falling toward field capacity"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const t = g.startMs + (((e.clientX - r.left) / r.width) * W - m.l) / iw * (g.endMs - g.startMs)
          let bi = 0
          for (let i = 1; i < g.series.length; i++) if (Math.abs(g.series[i].t - t) < Math.abs(g.series[bi].t - t)) bi = i
          setHover(bi)
        }}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={m.l - 6} y={y(t) + 4} className="axis" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {hours.map((t) => (
          <text key={t} x={x(t)} y={H - 8} className="axis" textAnchor="middle">
            {clock(t)}
          </text>
        ))}
        <line x1={m.l} x2={W - m.r} y1={y(NODE_CALIBRATION.wet)} y2={y(NODE_CALIBRATION.wet)} className="ref-line" />
        <text x={W - m.r - 4} y={y(NODE_CALIBRATION.wet) - 5} className="axis" textAnchor="end">
          probe in water ({NODE_CALIBRATION.wet})
        </text>
        {fc !== undefined && (
          <>
            <line x1={m.l} x2={W - m.r} y1={y(fc)} y2={y(fc)} className="ref-line ref-fc" />
            <text x={W - m.r - 4} y={y(fc) - 5} className="axis axis-fc" textAnchor="end">
              field capacity ≈ {fmt(fc)}
            </text>
          </>
        )}
        <path d={data} className="line-soil" />
        {fit && <path d={fitPath} className="line-fit" />}
        {h && (
          <>
            <line x1={x(h.t)} x2={x(h.t)} y1={m.t} y2={y(lo)} className="crosshair" />
            <circle cx={x(h.t)} cy={y(h.raw)} r={4} className="dot-soil" />
          </>
        )}
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: `${(x(h.t) / W) * 100}%` }}>
          <strong>{clock(h.t)}</strong>
          <div>Probe {fmt(h.raw)} · wetness {fmt(((h.raw - NODE_CALIBRATION.dry) / (NODE_CALIBRATION.wet - NODE_CALIBRATION.dry)) * 100)}% of water</div>
        </div>
      )}
    </div>
  )
}

export function GroundPanel({ result }: { result: EngineResult }) {
  const [g, setG] = useState<GroundSummary | null>(null)
  const [label, setLabel] = useState(BUNDLED.label)
  const [error, setError] = useState<string | null>(null)

  const load = (text: string, name: string) => {
    try {
      const s = summarizeGround(parseNodeCsv(text))
      if (!s) throw new Error('fewer than two readings with a soil value')
      setG(s)
      setLabel(name)
      setError(null)
    } catch (e) {
      setError(`${name}: ${(e as Error).message}`)
    }
  }

  useEffect(() => {
    fetch(BUNDLED.url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => load(t, BUNDLED.label))
      .catch((e) => setError(`Could not load the bundled field-node data (${(e as Error).message}).`))
  }, [])

  const month = g ? new Date(g.startMs).getUTCMonth() : 10
  const et0Day = result.features.monthly[month].et0MeanMm / DAYS_IN_MONTH[month]
  const fit = g?.fit
  const fcWet = fit ? fit.fcRaw / NODE_CALIBRATION.wet : NaN

  return (
    <section className="card">
      <div className="card-head">
        <h2>From the ground: our field node</h2>
        <span className="muted small">
          Arduino Nano + soil moisture probe · {label}
          {g ? ` · ${clock(g.startMs)}–${clock(g.endMs)} · ${fmt(g.n)} readings, every 5 s` : ''}
        </span>
      </div>

      {error && <p className="small error-text">{error}</p>}

      {g && (
        <>
          <div className="tiles">
            <Tile label="Recorded" value={`${fmt(g.hours, 1)} h`} sub={`longest gap ${fmt(g.maxGapMin * 60)} s`} p="observed" />
            <Tile
              label="Soil wetness"
              value={`${fmt(g.wetStart * 100)} → ${fmt(g.wetEnd * 100)}%`}
              sub="of the probe-in-water reading"
              p="observed"
            />
            <Tile label="Drying now" value={`${fmt(g.lastHourRatePerH, 1)} / h`} sub="probe units, last hour" p="observed" />
            {fit && (
              <Tile
                label="Field capacity"
                value={`≈ ${fmt(fit.fcRaw)}`}
                sub={`${fmt(fcWet * 100)}% of water · drains with τ ≈ ${fmt(fit.tauH, 1)} h`}
                p="modeled"
              />
            )}
            <Tile
              label="Water demand here"
              value={`${fmt(et0Day, 1)} mm/day`}
              sub={`typical ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month]} ET₀, NASA POWER`}
              p="modeled"
            />
          </div>

          <DrainageChart g={g} />

          <div className="data-notes small">
            <strong>What the ground tells the model</strong>
            <ul>
              <li>
                The readings were taken at night, when the sun drives almost none of the ~{fmt(et0Day, 1)} mm/day of evaporation NASA POWER gives for
                this field. So the fall from {fmt(g.rawStart)} to {fmt(g.rawEnd)} is water draining deeper, not evaporating.
              </li>
              {fit && (
                <li>
                  {fit.settled
                    ? `The drainage curve levels off near ${fmt(fit.fcRaw)}: this soil at field capacity, the "full bucket" the crop simulation starts from after a good watering. `
                    : `The curve has not levelled off yet; ${fmt(fit.fcRaw)} is an extrapolation. Record longer to confirm it. `}
                  From now on, readings below {fmt(fit.fcRaw)} mean roots are using stored water, the depletion the simulation tracks day by day.
                </li>
              )}
              {!g.temp && (
                <li>
                  No temperature this run: the DHT11 and the DS3231 clock were damaged. With a working sensor, the node's night lows can be compared with
                  NASA POWER to correct the frost risk for this exact spot.
                </li>
              )}
              <li>The first readings rise while the probe settles into the soil, so the curve is fitted from the wettest point.</li>
            </ul>
          </div>
        </>
      )}

      <label className="btn btn-quiet btn-inline ground-load">
        Load another node CSV
        <input
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) f.text().then((t) => load(t, f.name))
            e.target.value = ''
          }}
        />
      </label>
    </section>
  )
}

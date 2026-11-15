// "From the ground": readings from the team's field node (Arduino Nano + soil probe, see
// firmware/GoodToGrowNano). Measured data, shown next to the modeled climate; it does not change
// the plans. The soil's 100 % is the highest peak seen so far (right after a watering); a later
// recording that peaks higher becomes the new 100 %. That peak is remembered in this browser.
import { useEffect, useState } from 'react'
import { CROP_BY_ID, type EngineResult } from '../engine'
import {
  capacityName,
  clock,
  describeSite,
  NODE_CALIBRATION,
  NODE_SITE,
  parseNodeCsv,
  pctOfCapacity,
  summarizeGround,
  type GroundSummary,
  type SoilCapacity,
} from '../engine/ground'
import type { GroundContext } from '../agent/toolHandlers'
import { Badge } from './ClimatePanel'
import { fmt, MONTHS } from './format'

const BUNDLED = { url: `${import.meta.env.BASE_URL}data/ground/node-2026-11-15.csv`, label: 'night of 14–15 Nov 2026' }
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const CAPACITY_KEY = 'goodtogrow:soil-capacity'

function readCapacity(): SoilCapacity | null {
  try {
    const v = JSON.parse(localStorage.getItem(CAPACITY_KEY) ?? 'null') as SoilCapacity | null
    return v && Number.isFinite(v.raw) && Number.isFinite(v.ms) && typeof v.label === 'string' ? v : null
  } catch {
    return null
  }
}
function saveCapacity(c: SoilCapacity) {
  try {
    localStorage.setItem(CAPACITY_KEY, JSON.stringify(c))
  } catch {
    /* private window: the peak is only kept for this visit */
  }
}

/** Typical daily water demand (ET₀) at this field for the month the recording started, NASA POWER. */
function et0PerDay(result: EngineResult, startMs: number) {
  const month = new Date(startMs).getUTCMonth()
  return { month, mm: result.features.monthly[month].et0MeanMm / DAYS_IN_MONTH[month] }
}

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

/** Probe reading over time as % of the highest peak, with the fitted drainage curve and the level it approaches. */
function DrainageChart({ g, capRaw }: { g: GroundSummary; capRaw: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640
  const H = 220
  const m = { l: 40, r: 12, t: 14, b: 26 }
  const iw = W - m.l - m.r
  const ih = H - m.t - m.b
  const pct = (raw: number) => pctOfCapacity(raw, capRaw)
  const fit = g.fit
  const fcPct = fit ? pct(fit.fcRaw) : undefined
  const lo = Math.max(0, Math.floor((Math.min(pct(g.rawMin), fcPct ?? Infinity) - 4) / 10) * 10)
  const hi = Math.ceil((Math.max(pct(g.rawMax), 100) + 4) / 10) * 10
  const x = (t: number) => m.l + ((t - g.startMs) / (g.endMs - g.startMs)) * iw
  const y = (v: number) => m.t + ih - ((v - lo) / (hi - lo)) * ih
  const ticks = Array.from({ length: (hi - lo) / 10 + 1 }, (_, i) => lo + i * 10).filter((_, i, a) => a.length < 8 || i % 2 === 0)
  const hours = g.hourly.map((h) => h.hourMs).filter((t) => t >= g.startMs)
  const data = g.series.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(pct(p.raw)).toFixed(1)}`).join(' ')
  const fitPath = fit
    ? Array.from({ length: 60 }, (_, i) => {
        const t = fit.t0 + ((g.endMs - fit.t0) * i) / 59
        return `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(pct(fit.fcRaw + fit.b * Math.exp(-(t - fit.t0) / 3.6e6 / fit.tauH))).toFixed(1)}`
      }).join(' ')
    : ''
  const h = hover !== null ? g.series[hover] : null
  return (
    <div className="chart-wrap">
      <div className="legend">
        <span>
          <i className="sw sw-rain" /> Soil probe (1-minute mean)
        </span>
        {fit && (
          <span>
            <i className="sw sw-et0" /> Drainage curve fitted to it
          </span>
        )}
        <span>% of the highest peak: higher = wetter</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart"
        role="img"
        aria-label="Soil water over the recording as a percentage of the highest peak, falling as the soil drains"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const t = g.startMs + ((((e.clientX - r.left) / r.width) * W - m.l) / iw) * (g.endMs - g.startMs)
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
              {t}%
            </text>
          </g>
        ))}
        {hours.map((t) => (
          <text key={t} x={x(t)} y={H - 8} className="axis" textAnchor="middle">
            {clock(t)}
          </text>
        ))}
        <line x1={m.l} x2={W - m.r} y1={y(100)} y2={y(100)} className="ref-line ref-peak" />
        <text x={W - m.r - 4} y={y(100) - 5} className="axis axis-peak" textAnchor="end">
          highest peak = 100%
        </text>
        {fcPct !== undefined && (
          <>
            <line x1={m.l} x2={W - m.r} y1={y(fcPct)} y2={y(fcPct)} className="ref-line ref-fc" />
            <text x={W - m.r - 4} y={y(fcPct) + 14} className="axis axis-fc" textAnchor="end">
              {capacityName(NODE_SITE)} ≈ {fmt(fcPct)}%
            </text>
          </>
        )}
        <path d={data} className="line-soil" />
        {fit && <path d={fitPath} className="line-fit" />}
        <circle cx={x(g.peakMs)} cy={y(pct(g.peakRaw))} r={4} className="dot-peak" />
        {h && (
          <>
            <line x1={x(h.t)} x2={x(h.t)} y1={m.t} y2={y(lo)} className="crosshair" />
            <circle cx={x(h.t)} cy={y(pct(h.raw))} r={4} className="dot-soil" />
          </>
        )}
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: `${(x(h.t) / W) * 100}%` }}>
          <strong>{clock(h.t)}</strong>
          <div>
            {fmt(pct(h.raw))}% of the highest peak · probe {fmt(h.raw)}
          </div>
        </div>
      )}
    </div>
  )
}

export function GroundPanel({ result, onChange }: { result: EngineResult; onChange?: (g: GroundContext | null) => void }) {
  const [g, setG] = useState<GroundSummary | null>(null)
  const [label, setLabel] = useState(BUNDLED.label)
  const [capacity, setCapacity] = useState<SoilCapacity | null>(null)
  const [newPeak, setNewPeak] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const load = (text: string, name: string) => {
    try {
      const s = summarizeGround(parseNodeCsv(text))
      if (!s) throw new Error('fewer than two readings with a soil value')
      const prev = readCapacity()
      const higher = !prev || s.peakRaw > prev.raw
      const cap: SoilCapacity = higher ? { raw: s.peakRaw, ms: s.peakMs, label: name } : prev
      if (higher) saveCapacity(cap)
      setG(s)
      setLabel(name)
      setCapacity(cap)
      setNewPeak(Boolean(prev) && higher)
      setError(null)
      onChange?.({ summary: s, label: name, capacity: cap })
    } catch (e) {
      setError(`${name}: ${(e as Error).message}`)
    }
  }

  useEffect(() => {
    fetch(BUNDLED.url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => load(t, BUNDLED.label))
      .catch((e) => setError(`Could not load the field-node readings (${(e as Error).message}).`))
    // Loads the bundled night once; later recordings come from the file picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const capRaw = capacity?.raw ?? g?.peakRaw ?? NODE_CALIBRATION.wet
  const pct = (raw: number) => pctOfCapacity(raw, capRaw)
  const et0 = g ? et0PerDay(result, g.startMs) : null
  const fit = g?.fit
  const cropName = CROP_BY_ID[NODE_SITE.cropId]?.name.replace(/ \(.*\)$/, '') ?? NODE_SITE.cropId
  const capName = capacityName(NODE_SITE)
  const hoursSincePeak = g ? (g.endMs - g.peakMs) / 3.6e6 : 0

  return (
    <section className="ground-strip" aria-label="Soil moisture measured by our field node">
      <div className="ground-strip-head">
        <div>
          <span className="ground-kicker">From the ground · measured by our field node</span>
          <strong className="ground-title">
            {g ? `Soil water: ${fmt(pct(g.peakRaw))}% → ${fmt(pct(g.rawEnd))}% of its highest peak` : 'Soil moisture sensor'}
          </strong>
          <span className="small muted">
            Arduino Nano + soil probe · {label}
            {g ? ` · ${clock(g.startMs)}–${clock(g.endMs)} · ${fmt(g.n)} readings` : ''}
          </span>
        </div>
        <button type="button" className="btn btn-quiet btn-inline" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide readings' : 'Show readings'}
        </button>
      </div>

      {error && <p className="small error-text">{error}</p>}
      {newPeak && g && <p className="ground-newpeak small">New highest peak: this recording is now the soil’s 100%.</p>}

      {open && g && et0 && (
        <div className="ground-body">
          <span className="small muted ground-site">{describeSite(NODE_SITE, cropName)}</span>
          <div className="tiles" style={{ marginTop: 10 }}>
            <Tile label="Recorded" value={`${fmt(g.hours, 1)} h`} sub={`longest gap ${fmt(g.maxGapMin * 60)} s`} p="observed" />
            <Tile label="Soil water now" value={`${fmt(pct(g.rawEnd))}%`} sub={`of the highest peak, ${fmt(hoursSincePeak, 1)} h after this recording’s peak`} p="observed" />
            <Tile
              label="Drying now"
              value={`${fmt(Math.abs((g.lastHourRatePerH / (capRaw - NODE_CALIBRATION.dry)) * 100), 1)} pts/h`}
              sub="percentage points, last hour"
              p="observed"
            />
            {fit && (
              <Tile
                label={capName[0].toUpperCase() + capName.slice(1)}
                value={`≈ ${fmt(pct(fit.fcRaw))}%`}
                sub={`${fit.settled ? 'levelled off' : 'still draining: extrapolated'} · τ ≈ ${fmt(fit.tauH, 1)} h`}
                p="modeled"
              />
            )}
            <Tile label="Water demand here" value={`${fmt(et0.mm, 1)} mm/day`} sub={`typical ${MONTHS[et0.month]} ET₀, NASA POWER`} p="modeled" />
          </div>

          <DrainageChart g={g} capRaw={capRaw} />

          <div className="data-notes small">
            <strong>What the readings say</strong>
            <ul>
              <li>
                Recorded at night, when the sun drives almost none of the ~{fmt(et0.mm, 1)} mm/day of evaporation NASA POWER gives for this field. So the
                fall after the peak is mostly water draining down and out, not plants or sun using it.
              </li>
              {fit && (
                <li>
                  {fit.settled
                    ? `The curve levels off near ${fmt(pct(fit.fcRaw))}%: the ${capName}, the "full bucket" after a good watering. `
                    : `The curve has not levelled off yet, so ${fmt(pct(fit.fcRaw))}% is an extrapolation. Record longer to confirm it. `}
                  Below that level, roots are using stored water: the depletion the crop simulation tracks day by day.
                </li>
              )}
              {!g.temp && <li>No temperature this run (the DHT11 and the clock module were damaged), so frost risk still comes from NASA POWER only.</li>}
              <li>The first readings rise while the probe settles into the soil, so the curve is fitted from the wettest point.</li>
              {NODE_SITE.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
              <li>These readings are shown for comparison and do not change the plans.</li>
            </ul>
          </div>

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
        </div>
      )}
    </section>
  )
}

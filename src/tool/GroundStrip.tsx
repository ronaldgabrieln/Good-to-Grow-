import { useState } from 'react'
import { CROP_BY_ID, type EngineResult } from '../engine'
import {
  capacityName,
  clock,
  daylightEtShare,
  describeSite,
  mlPerMm,
  NODE_CALIBRATION,
  NODE_SITE,
  pctOfCapacity,
  siteVolumeL,
  type GroundSite,
  type GroundSummary,
  type SoilCapacity,
} from '../engine/ground'
import { Badge } from './ClimatePanel'
import { fmt } from './format'
import { et0ForMonth, RECORDINGS, type GroundState } from './useGround'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const cropLabel = (s: GroundSite) => CROP_BY_ID[s.cropId]?.name.replace(/ \(.*\)$/, '') ?? 'Basil'
const dayTime = (ms: number) => `${new Date(ms).getUTCDate()} ${MONTH_NAMES[new Date(ms).getUTCMonth()]} ${clock(ms)}`

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

/**
 * Soil water from the wettest moment of the recording onward, as % of the highest peak (100 %),
 * with the fitted drainage curve and the field-capacity level it approaches.
 */
function DrainageChart({ g, cap, site }: { g: GroundSummary; cap: SoilCapacity; site: GroundSite }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640
  const H = 220
  const m = { l: 44, r: 44, t: 14, b: 26 }
  const iw = W - m.l - m.r
  const ih = H - m.t - m.b
  const pct = (raw: number) => pctOfCapacity(raw, cap.raw)
  /** Probe reading at a given % of the highest peak (right-hand axis). */
  const rawAt = (p: number) => NODE_CALIBRATION.dry + ((cap.raw - NODE_CALIBRATION.dry) * p) / 100
  const shown = g.series.filter((p) => p.t >= g.peakMs)
  const t0 = g.peakMs
  const t1 = Math.max(g.endMs, t0 + 60000)
  const fit = g.fit
  const fcPct = fit ? pct(fit.fcRaw) : undefined
  const vals = shown.map((p) => pct(p.raw))
  const lo = Math.max(0, Math.floor((Math.min(...vals, fcPct ?? Infinity) - 3) / 5) * 5)
  const hi = Math.max(100, Math.ceil(Math.max(...vals) / 5) * 5) + 5
  const step = hi - lo > 40 ? 10 : 5
  const x = (t: number) => m.l + ((t - t0) / (t1 - t0)) * iw
  const y = (v: number) => m.t + ih - ((v - lo) / (hi - lo)) * ih
  const ticks = Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, i) => lo + i * step).filter((v) => v <= 100 || v === lo)
  const hours = g.hourly.map((h) => h.hourMs).filter((t) => t > t0 + 600000)
  const data = shown.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(pct(p.raw)).toFixed(1)}`).join(' ')
  const fitPath = fit
    ? Array.from({ length: 60 }, (_, i) => {
        const t = fit.t0 + ((t1 - fit.t0) * i) / 59
        return `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(pct(fit.fcRaw + fit.b * Math.exp(-(t - fit.t0) / 3.6e6 / fit.tauH))).toFixed(1)}`
      }).join(' ')
    : ''
  const peakHere = pct(g.peakRaw)
  const h = hover !== null ? shown[hover] : null
  return (
    <div className="chart-wrap">
      <div className="legend">
        <span>
          <i className="sw sw-rain" /> Soil water, % of the highest peak
        </span>
        {fit && (
          <span>
            <i className="sw sw-et0" /> Drainage curve fitted to it
          </span>
        )}
        <span>left: % of the highest peak · right: actual probe reading</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart"
        role="img"
        aria-label={`Soil water falling from ${fmt(peakHere)}% of the highest peak toward ${capacityName(site)}`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const t = t0 + ((((e.clientX - r.left) / r.width) * W - m.l) / iw) * (t1 - t0)
          let bi = 0
          for (let i = 1; i < shown.length; i++) if (Math.abs(shown[i].t - t) < Math.abs(shown[bi].t - t)) bi = i
          setHover(bi)
        }}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={m.l - 6} y={y(v) + 4} className="axis" textAnchor="end">
              {v}%
            </text>
            <text x={W - m.r + 6} y={y(v) + 4} className="axis axis-raw" textAnchor="start">
              {fmt(rawAt(v))}
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
          highest peak = 100% (reading {fmt(cap.raw)})
        </text>
        {fit && fcPct !== undefined && (
          <>
            <line x1={m.l} x2={W - m.r} y1={y(fcPct)} y2={y(fcPct)} className="ref-line ref-fc" />
            <text x={W - m.r - 4} y={y(fcPct) - 5} className="axis axis-fc" textAnchor="end">
              {capacityName(site)} ≈ {fmt(fcPct)}% (reading {fmt(fit.fcRaw)})
            </text>
          </>
        )}
        <path d={data} className="line-soil" />
        {fit && <path d={fitPath} className="line-fit" />}
        <circle cx={x(t0)} cy={y(peakHere)} r={5} className="dot-peak" />
        <text x={x(t0) + 9} y={y(peakHere) + (peakHere >= 99 ? 15 : -7)} className="axis axis-peak">
          {peakHere >= 99.5 ? 'peak' : `peak ${fmt(peakHere)}%`} ({fmt(g.peakRaw)}) {clock(t0)}
        </text>
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
            {fmt(pct(h.raw), 1)}% of the highest peak · reading {fmt(h.raw)}
          </div>
        </div>
      )}
    </div>
  )
}

function headline(g: GroundSummary, site: GroundSite) {
  const fit = g.fit
  if (fit?.settled && g.rawEnd <= fit.fcRaw + 10) return `Your soil is full: at ${capacityName(site)}`
  if (fit && g.rawEnd > fit.fcRaw) return 'Your soil is wet and still draining'
  if (fit && g.rawEnd < fit.fcRaw) return 'Your soil is drying: roots are using stored water'
  return 'Soil moisture measured on your field'
}

/** Main-screen summary of the field node, with the chart and the details one tap away. */
export function GroundStrip({ result, ground }: { result: EngineResult; ground: GroundState }) {
  const [open, setOpen] = useState(false)
  const { g, label, error, load, pick, newPeak, resetCapacity } = ground
  const { month, et0Day } = et0ForMonth(result, g)
  const site = NODE_SITE
  const cap_ = capacityName(site)
  const fit = g?.fit
  // Until a peak is stored, this recording's own peak is the 100 %.
  const cap: SoilCapacity | null = ground.capacity ?? (g ? { raw: g.peakRaw, ms: g.peakMs, label } : null)
  const pct = (raw: number) => (cap ? pctOfCapacity(raw, cap.raw) : NaN)
  const peakFromHere = !!g && !!cap && cap.raw === g.peakRaw
  const sincePeakH = g ? (g.endMs - g.peakMs) / 3.6e6 : 0
  // Daytime or night? Share of the day's NASA ET0 that falls inside the recording (sun-shaped model).
  const sunShare = g ? daylightEtShare(g.peakMs, g.endMs, site.lat, site.lon) : 0
  const isNight = sunShare < 0.03
  const expectMm = et0Day * sunShare * (CROP_BY_ID[site.cropId]?.kc[1] ?? 1)
  const expectMl = expectMm * mlPerMm(site)
  const vol = siteVolumeL(site)
  // Spread through the pot, in raw units (container capacity ~0.40 m³/m³ assumed at the drained level).
  const expectRaw = cap && vol > 0 ? (expectMl / (vol * 1000) / 0.4) * (fit?.fcRaw ?? cap.raw * 0.82) : NaN
  const tr = g?.trend
  const toPctPerH = (raw: number) => (cap ? (raw / cap.raw) * 100 : NaN)
  const trendDetectable = !!tr && Math.abs(tr.slopePerH) > 2 * tr.sePerH

  return (
    <section className="ground-strip" aria-label="Soil moisture measured on your field">
      <div className="ground-strip-head">
        <div>
          <span className="ground-kicker">
            Measured on your field <Badge p="observed" />
          </span>
          <strong className="ground-title">{g ? headline(g, site) : error ? 'Field sensor data not loaded' : 'Loading field sensor data…'}</strong>
          {g && (
            <span className="small muted">
              {label} · {clock(g.startMs)}–{clock(g.endMs)} · soil water now {fmt(pct(g.rawEnd))}% of the highest peak
            </span>
          )}
          {g && (
            <span className="small muted ground-site">
              Probe in: {describeSite(site, cropLabel(site))}
            </span>
          )}
        </div>
        {g && (
          <select
            className="ground-pick"
            aria-label="Which recording to show"
            value={RECORDINGS.findIndex((r) => r.label === label)}
            onChange={(e) => pick(Number(e.target.value))}
          >
            {RECORDINGS.map((r, i) => (
              <option key={r.url} value={i}>
                {r.label}
              </option>
            ))}
            {!RECORDINGS.some((r) => r.label === label) && <option value={-1}>{label}</option>}
          </select>
        )}
        {g && (
          <button type="button" className="btn btn-quiet btn-inline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Hide' : 'See the readings'}
          </button>
        )}
      </div>

      {error && <p className="small error-text">{error}</p>}
      {g && newPeak && (
        <p className="small ground-newpeak">New highest peak: the soil read wetter than ever before, so this watering is the new 100%.</p>
      )}

      {g && cap && open && (
        <div className="ground-body">
          <div className="tiles">
            <Tile label="Soil water now" value={`${fmt(pct(g.rawEnd))}%`} sub="of the highest peak (100%)" p="observed" />
            <Tile
              label="Since the peak"
              value={`${fmt(pct(g.peakRaw))} → ${fmt(pct(g.rawEnd))}%`}
              sub={`in ${fmt(sincePeakH, 1)} h, from ${clock(g.peakMs)}`}
              p="observed"
            />
            {isNight || !tr ? (
              <Tile label="Drying now" value={`${fmt(pct(cap.raw + g.lastHourRatePerH) - 100, 1)}% / h`} sub="last hour" p="observed" />
            ) : (
              <Tile
                label="Trend in the sun"
                value={`${fmt(toPctPerH(tr.slopePerH), 1)} ± ${fmt(toPctPerH(2 * tr.sePerH), 1)}% / h`}
                sub={trendDetectable ? 'drying is measurable' : 'not distinguishable from zero'}
                p="observed"
              />
            )}
            {fit && (
              <Tile
                label={cap_.charAt(0).toUpperCase() + cap_.slice(1)}
                value={`≈ ${fmt(pct(fit.fcRaw))}%`}
                sub={`of the peak · drains with τ ≈ ${fmt(fit.tauH, 1)} h`}
                p="modeled"
              />
            )}
            <Tile label="Water demand here" value={`${fmt(et0Day, 1)} mm/day`} sub={`typical ${MONTH_NAMES[month]} ET₀, NASA POWER`} p="modeled" />
          </div>

          <DrainageChart g={g} cap={cap} site={site} />

          <div className="data-notes small">
            <strong>What the ground tells the model</strong>
            <ul>
              <li>
                100% is the highest peak of water recorded so far ({peakFromHere ? 'this recording' : cap.label}, {dayTime(cap.ms)}), right after
                watering. If you water again and the probe reads higher, that becomes the new 100%.
                {!peakFromHere && (
                  <>
                    {' '}
                    <button type="button" className="link-btn" onClick={resetCapacity}>
                      Use this recording's peak as 100% instead
                    </button>
                  </>
                )}
              </li>
              {isNight ? (
                <li>
                  The readings were taken at night, when the sun drives almost none of the ~{fmt(et0Day, 1)} mm/day of evaporation NASA POWER gives
                  for your field. So the fall from {fmt(pct(g.peakRaw))}% to {fmt(pct(g.rawEnd))}% is water draining deeper, not evaporating.
                </li>
              ) : (
                <>
                  <li>
                    In daylight, {clock(g.peakMs)}–{clock(g.endMs)}. NASA's typical {MONTH_NAMES[month]} demand of {fmt(et0Day, 1)} mm/day puts{' '}
                    {fmt(sunShare * 100)}% of the day's evaporation in this window: about {fmt(expectMm, 1)} mm, or {fmt(expectMl)} mL from this pot
                    {Number.isFinite(expectRaw) ? ` (roughly ${fmt(expectRaw)} probe units spread through the soil)` : ''}.
                  </li>
                  {tr && (
                    <li>
                      The probe's trend was {fmt(tr.slopePerH, 1)} ± {fmt(2 * tr.sePerH, 1)} units per hour with {fmt(tr.sdRaw)} units of scatter between
                      readings, so {trendDetectable ? 'the drying is measurable.' : 'the expected drying is smaller than the scatter: this run is too short to see the sun dry the pot.'}{' '}
                      Record a whole day, or weigh the pot before and after (1 g lost = 1 mL).
                    </li>
                  )}
                  <li>
                    Sun-warmed soil makes this probe read higher (about 2% per °C) even while it dries, so midday rises are probably heat, not water. A
                    soil thermometer would let us correct for it.
                  </li>
                </>
              )}
              {fit && (
                <li>
                  {fit.settled
                    ? `The drainage curve levels off near ${fmt(pct(fit.fcRaw))}%: this soil at ${cap_}, the "full bucket" after a good watering. `
                    : `The curve has not levelled off yet; ${fmt(pct(fit.fcRaw))}% is an extrapolation. Record longer to confirm it. `}
                  Below {fmt(pct(fit.fcRaw))}%, roots are using stored water, the depletion the simulation tracks day by day.
                </li>
              )}
              {site.kind === 'pot' && site.container && (
                <li>
                  These readings come from a {fmt(siteVolumeL(site), 0)} L {site.container.material} pot of {site.soil}, not from field soil.{' '}
                  {site.notes.slice(1).join(' ')} Weighing the pot is the most accurate check: every gram lost is 1 mL of water, and{' '}
                  {fmt(mlPerMm(site), 0)} mL is 1 mm over this pot.
                </li>
              )}
              {!g.temp && (
                <li>
                  Adding sensors makes the data clearer: a temperature and humidity sensor would let the node's night lows be compared with NASA
                  POWER to check frost risk at this exact spot, and a soil thermometer would correct the probe for sun-warming.
                </li>
              )}
              <li>These readings are shown next to the model; they do not change the plans above, which come from 30 years of NASA weather.</li>
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

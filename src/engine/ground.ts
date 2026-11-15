// Ground truth from the field node (Arduino Nano + soil probe, firmware/GoodToGrowNano).
//
// The node writes two CSV shapes; both are accepted:
//   live recorder:  pc_time,temp_c,rh_pct,soil_pct,soil_raw            (every 5 s, PC clock)
//   EEPROM dump:    time,temp_c,temp_src,rh_pct,soil_raw,soil_pct       (every 5 min, node clock)
//
// What one night of readings can tell the model: after the soil is wetted it drains toward
// field capacity, and the probe reading levels off there. The level it settles at is the
// probe's "bucket full" reading, the state the soil-water balance in simulate.ts calls Dr = 0.

export interface GroundReading {
  /** Local time, ms since epoch (parsed as written, no timezone shift). */
  t: number
  soilRaw: number
  tempC: number | null
  rhPct: number | null
}

/** Probe calibration saved on the node with the `dry` / `wet` commands (raw ADC, 0–1023). */
export interface ProbeCalibration {
  dry: number
  wet: number
}

/** Calibration done on 2026-11-14: probe in dry air = 0, probe in a glass of water = 631. */
export const NODE_CALIBRATION: ProbeCalibration = { dry: 0, wet: 631 }

/** Where the probe is: a container (pot) or the open field. Changes how the readings are read. */
export interface GroundSite {
  kind: 'pot' | 'field'
  /** Crop id from crops.ts. */
  cropId: string
  soil: string
  place: string
  lat: number
  lon: number
  container?: {
    material: 'terracotta' | 'plastic'
    drainageHoles: boolean
    topDiameterCm: number
    soilDepthCm: number
  }
  /** What was measured and what was assumed about this site. */
  notes: string[]
}

/** The team's test pot (reported 2026-11-15). */
export const NODE_SITE: GroundSite = {
  kind: 'pot',
  cropId: 'basil',
  soil: 'potting mix blended with garden soil',
  place: 'Ensenada, B.C.',
  lat: 31.87,
  lon: -116.6,
  container: { material: 'terracotta', drainageHoles: true, topDiameterCm: 25, soilDepthCm: 22 },
  notes: [
    'Pot size is approximate (about 25 cm across, 22 cm of soil).',
    'Terracotta walls are porous: water also evaporates through the sides, so the pot dries faster than plastic or open ground.',
    'The level the soil drains to is the pot’s container capacity. A pot holds more water than the same soil in the ground (water collects above the drainage holes), so it is not the field capacity of Maneadero soil.',
  ],
}

/** Soil surface of a container, m² (top opening). */
export const siteAreaM2 = (s: GroundSite) => (s.container ? Math.PI * (s.container.topDiameterCm / 200) ** 2 : NaN)

/** Soil volume of a container, litres (cylinder; a tapered pot holds a bit less). */
export const siteVolumeL = (s: GroundSite) => (s.container ? siteAreaM2(s) * (s.container.soilDepthCm / 100) * 1000 : NaN)

/** Millilitres of water that make 1 mm over the container's surface (1 mm × 1 m² = 1 L). */
export const mlPerMm = (s: GroundSite) => siteAreaM2(s) * 1000

/** One-line description, e.g. "Basil pot · 25 × 22 cm terracotta · potting mix … · Ensenada, B.C." */
export function describeSite(s: GroundSite, cropName: string): string {
  const c = s.container
  return s.kind === 'pot' && c
    ? `${cropName} pot · ${c.topDiameterCm} × ${c.soilDepthCm} cm ${c.material}${c.drainageHoles ? ', with drainage holes' : ', no drainage holes'} · ${s.soil} · ${s.place}`
    : `${cropName} field · ${s.soil} · ${s.place}`
}

/** "container capacity" for a pot, "field capacity" in the ground. */
export const capacityName = (s: GroundSite) => (s.kind === 'pot' ? 'container capacity' : 'field capacity')

export interface DrainageFit {
  /** Time the fitted curve starts (the wettest reading), ms. */
  t0: number
  /** Excess over field capacity at t0, raw: reading(t) = fcRaw + b·exp(−(t − t0)/τ). */
  b: number
  /** Reading the soil is draining toward (field capacity for this probe), raw. */
  fcRaw: number
  /** Time constant of the drainage, hours. */
  tauH: number
  /** Root-mean-square error of the fit, raw units. */
  rmse: number
  /** Drop the curve still predicts after the last reading, raw. */
  remainingRaw: number
  /** True when less than 5 % of the peak is left to drain; otherwise fcRaw is an extrapolation. */
  settled: boolean
}

export interface GroundSummary {
  n: number
  startMs: number
  endMs: number
  hours: number
  /** Longest gap between readings, minutes. */
  maxGapMin: number
  rawStart: number
  rawEnd: number
  rawMin: number
  rawMax: number
  /** Wettest one-minute mean in the recording (the latest one if it repeats), raw, and when it was. */
  peakRaw: number
  peakMs: number
  /** Change over the last hour, raw units per hour (negative = drying). */
  lastHourRatePerH: number
  /** Mean readings per clock hour. */
  hourly: { hourMs: number; raw: number }[]
  /** One-minute means, for charting. */
  series: { t: number; raw: number }[]
  fit: DrainageFit | null
  temp: { min: number; max: number; n: number } | null
  rh: { min: number; max: number; n: number } | null
}

function parseLocal(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim())
  if (!m) return NaN
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
}

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null
  const v = s.trim()
  if (v === '' || v.toLowerCase() === 'nan') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

/** Parses either node CSV. Rows without a soil_raw value or a valid time are skipped. */
export function parseNodeCsv(text: string): GroundReading[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'))
  if (!lines.length) return []
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const ti = head.indexOf('pc_time') >= 0 ? head.indexOf('pc_time') : head.indexOf('time')
  const ri = head.indexOf('soil_raw')
  if (ti < 0 || ri < 0) throw new Error('Not a field-node CSV: needs a time (or pc_time) and a soil_raw column.')
  const tci = head.indexOf('temp_c')
  const hi = head.indexOf('rh_pct')
  const out: GroundReading[] = []
  for (const l of lines.slice(1)) {
    const c = l.split(',')
    const t = parseLocal(c[ti] ?? '')
    const raw = num(c[ri])
    if (!Number.isFinite(t) || raw === null) continue
    out.push({ t, soilRaw: raw, tempC: tci >= 0 ? num(c[tci]) : null, rhPct: hi >= 0 ? num(c[hi]) : null })
  }
  return out.sort((a, b) => a.t - b.t)
}

/**
 * The soil's 100 %: the highest peak reading seen so far (right after a watering). A later watering
 * that reads higher becomes the new 100 %.
 */
export interface SoilCapacity {
  raw: number
  ms: number
  /** Recording the peak came from. */
  label: string
}

/** A reading as a percentage of the highest peak (0 = probe in dry air). */
export function pctOfCapacity(raw: number, capacityRaw: number, cal: ProbeCalibration = NODE_CALIBRATION): number {
  return capacityRaw === cal.dry ? NaN : ((raw - cal.dry) / (capacityRaw - cal.dry)) * 100
}

/**
 * Fits raw(t) = fc + b·exp(−t/τ) (exponential drainage toward field capacity).
 * τ by log-spaced search, fc and b by linear least squares for each τ.
 */
export function fitDrainage(series: { t: number; raw: number }[]): DrainageFit | null {
  if (series.length < 30) return null
  const t0 = series[0].t
  const xs = series.map((p) => (p.t - t0) / 3.6e6)
  const ys = series.map((p) => p.raw)
  const spanH = xs[xs.length - 1]
  if (spanH < 1) return null
  const n = xs.length
  /** For a given τ the model is linear in fc and b: solve those by least squares. */
  const solve = (tau: number) => {
    let se = 0, see = 0, sy = 0, sey = 0
    for (let i = 0; i < n; i++) {
      const e = Math.exp(-xs[i] / tau)
      se += e; see += e * e; sy += ys[i]; sey += e * ys[i]
    }
    const det = n * see - se * se
    if (Math.abs(det) < 1e-12) return null
    const b = (n * sey - se * sy) / det
    const fc = (sy - b * se) / n
    let sse = 0
    for (let i = 0; i < n; i++) {
      const r = ys[i] - (fc + b * Math.exp(-xs[i] / tau))
      sse += r * r
    }
    return { fc, b, tau, sse }
  }
  // Coarse log grid (0.2 h … 100 h, 3 % steps) to find the right valley, then golden-section
  // search on ln τ between the neighbouring grid points for the exact minimum.
  const STEPS = 200
  const tauAt = (k: number) => 0.2 * Math.pow(500, k / STEPS)
  let best: { fc: number; b: number; tau: number; sse: number } | null = null
  let bestK = 0
  for (let k = 0; k <= STEPS; k++) {
    const s = solve(tauAt(k))
    if (s && (!best || s.sse < best.sse)) {
      best = s
      bestK = k
    }
  }
  if (!best) return null
  const g = (Math.sqrt(5) - 1) / 2
  let lo = Math.log(tauAt(Math.max(0, bestK - 1)))
  let hi = Math.log(tauAt(Math.min(STEPS, bestK + 1)))
  for (let it = 0; it < 60; it++) {
    const c = hi - g * (hi - lo)
    const d = lo + g * (hi - lo)
    if ((solve(Math.exp(c))?.sse ?? Infinity) < (solve(Math.exp(d))?.sse ?? Infinity)) hi = d
    else lo = c
  }
  const refined = solve(Math.exp((lo + hi) / 2))
  if (refined && refined.sse <= best.sse) best = refined
  if (best.b <= 0) return null // not a drying curve
  // Settled when what is left to drain is under 5 % of the peak reading (fc + b).
  const remaining = best.b * Math.exp(-spanH / best.tau)
  return {
    t0,
    b: best.b,
    fcRaw: best.fc,
    tauH: best.tau,
    rmse: Math.sqrt(best.sse / n),
    remainingRaw: remaining,
    settled: remaining <= 0.05 * (best.fc + best.b),
  }
}

export function summarizeGround(readings: GroundReading[]): GroundSummary | null {
  if (readings.length < 2) return null
  const first = readings[0]
  const last = readings[readings.length - 1]

  // One-minute means.
  const bins = new Map<number, { s: number; n: number }>()
  for (const r of readings) {
    const k = Math.floor(r.t / 60000) * 60000
    const b = bins.get(k) ?? { s: 0, n: 0 }
    b.s += r.soilRaw
    b.n++
    bins.set(k, b)
  }
  const series = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([t, b]) => ({ t, raw: b.s / b.n }))

  const hourBins = new Map<number, { s: number; n: number }>()
  for (const p of series) {
    const k = Math.floor(p.t / 3.6e6) * 3.6e6
    const b = hourBins.get(k) ?? { s: 0, n: 0 }
    b.s += p.raw
    b.n++
    hourBins.set(k, b)
  }
  const hourly = [...hourBins.entries()].sort((a, b) => a[0] - b[0]).map(([hourMs, b]) => ({ hourMs, raw: b.s / b.n }))

  let maxGap = 0
  for (let i = 1; i < readings.length; i++) maxGap = Math.max(maxGap, readings[i].t - readings[i - 1].t)

  // Average of the first and last 10 minutes, so single-reading noise doesn't decide start/end.
  const meanWhere = (f: (t: number) => boolean) => {
    const v = series.filter((p) => f(p.t)).map((p) => p.raw)
    return v.reduce((a, b) => a + b, 0) / v.length
  }
  const rawStart = meanWhere((t) => t < first.t + 600000)
  const rawEnd = meanWhere((t) => t > last.t - 600000)
  const hourAgo = meanWhere((t) => t > last.t - 4200000 && t < last.t - 3000000)

  const stats = (vals: (number | null)[]) => {
    const v = vals.filter((x): x is number => x !== null)
    return v.length ? { min: Math.min(...v), max: Math.max(...v), n: v.length } : null
  }
  const raws = readings.map((r) => r.soilRaw)
  // Drainage starts at the wettest point: before it the probe is still settling into the soil,
  // and a later watering that reads higher starts a new drainage.
  const peakIdx = series.reduce((bi, p, i) => (p.raw >= series[bi].raw ? i : bi), 0)
  return {
    n: readings.length,
    startMs: first.t,
    endMs: last.t,
    hours: (last.t - first.t) / 3.6e6,
    maxGapMin: maxGap / 60000,
    rawStart,
    rawEnd,
    rawMin: Math.min(...raws),
    rawMax: Math.max(...raws),
    peakRaw: series[peakIdx].raw,
    peakMs: series[peakIdx].t,
    lastHourRatePerH: Number.isFinite(hourAgo) ? rawEnd - hourAgo : NaN,
    hourly,
    series,
    fit: fitDrainage(series.slice(peakIdx)),
    temp: stats(readings.map((r) => r.tempC)),
    rh: stats(readings.map((r) => r.rhPct)),
  }
}

/** Formats a local-time ms value (from parseLocal) as "HH:MM". */
export const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16)

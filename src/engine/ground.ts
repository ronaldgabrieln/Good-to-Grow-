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
  /** False when the curve has not visibly levelled off, so fcRaw is an extrapolation. */
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
  /** Probe wetness index: 0 = dry air, 1 = water, from the calibration. Can exceed 1 in salty, wet soil. */
  wetStart: number
  wetEnd: number
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

const wetness = (raw: number, cal: ProbeCalibration) => (cal.wet === cal.dry ? NaN : (raw - cal.dry) / (cal.wet - cal.dry))

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
  let best: { fc: number; b: number; tau: number; sse: number } | null = null
  for (let k = 0; k <= 200; k++) {
    const tau = 0.2 * Math.pow(500, k / 200) // 0.2 h … 100 h
    let se = 0, see = 0, sy = 0, sey = 0
    const n = xs.length
    for (let i = 0; i < n; i++) {
      const e = Math.exp(-xs[i] / tau)
      se += e; see += e * e; sy += ys[i]; sey += e * ys[i]
    }
    const det = n * see - se * se
    if (Math.abs(det) < 1e-12) continue
    const b = (n * sey - se * sy) / det
    const fc = (sy - b * se) / n
    let sse = 0
    for (let i = 0; i < n; i++) {
      const r = ys[i] - (fc + b * Math.exp(-xs[i] / tau))
      sse += r * r
    }
    if (!best || sse < best.sse) best = { fc, b, tau, sse }
  }
  if (!best || best.b <= 0) return null // not a drying curve
  // Settled when the record covers at least ~1.5 time constants (≈ 78 % of the drop is seen).
  return { t0, b: best.b, fcRaw: best.fc, tauH: best.tau, rmse: Math.sqrt(best.sse / xs.length), settled: spanH >= 1.5 * best.tau }
}

export function summarizeGround(readings: GroundReading[], cal: ProbeCalibration = NODE_CALIBRATION): GroundSummary | null {
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
    wetStart: wetness(rawStart, cal),
    wetEnd: wetness(rawEnd, cal),
    lastHourRatePerH: Number.isFinite(hourAgo) ? rawEnd - hourAgo : NaN,
    hourly,
    series,
    // Drainage starts at the wettest point: before it the probe is still settling into the soil.
    fit: fitDrainage(series.slice(series.reduce((bi, p, i) => (p.raw > series[bi].raw ? i : bi), 0))),
    temp: stats(readings.map((r) => r.tempC)),
    rh: stats(readings.map((r) => r.rhPct)),
  }
}

/** Formats a local-time ms value (from parseLocal) as "HH:MM". */
export const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16)

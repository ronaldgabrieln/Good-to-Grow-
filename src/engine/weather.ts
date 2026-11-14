import { et0FromDaily } from './et0'
import type { Scenario, WeatherSeries } from './types'

/** Compact column format (also what scripts/build-demo-data.mjs writes). */
export interface PowerColumns {
  lat: number
  lon: number
  gridElevationM: number
  start: string // YYYY-MM-DD, must be Jan 1
  tmax: number[]
  tmin: number[]
  rain: number[]
  rad: number[]
  rh: number[]
  wind: number[]
  /** POWER grid cells averaged into this series (when the field sits near a cell boundary). */
  cells?: { lat: number; lon: number; elevationM: number }[]
}

export const POWER_PARAMS = ['T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'ALLSKY_SFC_SW_DWN', 'RH2M', 'WS2M']

/** First year of weather the engine replays; satellite frames start here too. */
export const ANALYSIS_START_YEAR = 1995
export const ANALYSIS_END_YEAR = 2024

export function powerUrl(lat: number, lon: number, startYear = ANALYSIS_START_YEAR, endYear = ANALYSIS_END_YEAR): string {
  return (
    `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${POWER_PARAMS.join(',')}` +
    `&community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}` +
    `&start=${startYear}0101&end=${endYear}1231&format=JSON`
  )
}

/** Convert a raw NASA POWER daily point response into columns. Fills gaps (-999) by carrying the last value. */
export function columnsFromPowerResponse(json: unknown, lat: number, lon: number): PowerColumns {
  const j = json as {
    geometry: { coordinates: number[] }
    properties: { parameter: Record<string, Record<string, number>> }
  }
  const p = j.properties.parameter
  const keys = Object.keys(p.T2M_MAX).sort()
  const col = (name: string) => {
    let last = 0
    return keys.map((k) => {
      const v = p[name][k]
      if (v === undefined || v <= -990) return last
      last = v
      return v
    })
  }
  const k0 = keys[0]
  return {
    lat,
    lon,
    gridElevationM: j.geometry.coordinates[2] ?? 0,
    start: `${k0.slice(0, 4)}-${k0.slice(4, 6)}-${k0.slice(6, 8)}`,
    tmax: col('T2M_MAX'),
    tmin: col('T2M_MIN'),
    rain: col('PRECTOTCORR'),
    rad: col('ALLSKY_SFC_SW_DWN'),
    rh: col('RH2M'),
    wind: col('WS2M'),
  }
}

/** Average several POWER cells day by day (all must share the same start date and length). */
export function blendColumns(cols: PowerColumns[], lat: number, lon: number): PowerColumns {
  if (cols.length === 1) return { ...cols[0], cells: [{ lat: cols[0].lat, lon: cols[0].lon, elevationM: cols[0].gridElevationM }] }
  const n = Math.min(...cols.map((c) => c.tmax.length))
  const avg = (k: 'tmax' | 'tmin' | 'rain' | 'rad' | 'rh' | 'wind') =>
    Array.from({ length: n }, (_, i) => Number((cols.reduce((s, c) => s + c[k][i], 0) / cols.length).toFixed(2)))
  return {
    lat,
    lon,
    gridElevationM: cols.reduce((s, c) => s + c.gridElevationM, 0) / cols.length,
    start: cols[0].start,
    tmax: avg('tmax'),
    tmin: avg('tmin'),
    rain: avg('rain'),
    rad: avg('rad'),
    rh: avg('rh'),
    wind: avg('wind'),
    cells: cols.map((c) => ({ lat: c.lat, lon: c.lon, elevationM: c.gridElevationM })),
  }
}

export interface RainFlag {
  start: string
  end: string
  totalMm: number
  peakMm: number
}

/**
 * Rain quality control. Reanalysis precipitation occasionally contains implausible spells.
 * A day is suspect if it exceeds max(120 mm, 3 × the 99th percentile of wet days); the whole
 * contiguous wet spell around it is removed (set to 0) and reported, never silently.
 */
export function qcRain(rain: number[], start: string): { rain: number[]; flags: RainFlag[] } {
  const wet = rain.filter((r) => r >= 1).sort((a, b) => a - b)
  const p99 = wet.length ? wet[Math.floor(wet.length * 0.99)] : 0
  const limit = Math.max(120, 3 * p99)
  const out = [...rain]
  const flags: RainFlag[] = []
  const t0 = new Date(`${start}T00:00:00Z`).getTime()
  const iso = (i: number) => new Date(t0 + i * 86400000).toISOString().slice(0, 10)
  for (let i = 0; i < rain.length; i++) {
    if (rain[i] <= limit || out[i] === 0) continue
    let a = i
    let b = i
    while (a > 0 && rain[a - 1] >= 1) a--
    while (b < rain.length - 1 && rain[b + 1] >= 1) b++
    let total = 0
    let peak = 0
    for (let k = a; k <= b; k++) {
      total += rain[k]
      peak = Math.max(peak, rain[k])
      out[k] = 0
    }
    flags.push({ start: iso(a), end: iso(b), totalMm: total, peakMm: peak })
    i = b
  }
  return { rain: out, flags }
}

/**
 * Build the daily series the engine runs on, applying a climate scenario
 * (+ΔT on Tmax/Tmin, ×(1+Δrain) on precipitation) and computing ET0.
 * ET0 responds to the temperature shift through the Penman–Monteith terms.
 */
export function prepareWeather(
  c: PowerColumns,
  source: WeatherSeries['source'],
  elevationM: number,
  scenario: Scenario = { deltaTempC: 0, rainChange: 0 },
): WeatherSeries {
  const n = c.tmax.length
  const start = new Date(`${c.start}T00:00:00Z`)
  const year: number[] = new Array(n)
  const doy: number[] = new Array(n)
  const month: number[] = new Array(n)
  const yearStart: number[] = []
  const startYear = start.getUTCFullYear()
  let curYear = -1
  let dayOfYear = 0
  for (let i = 0; i < n; i++) {
    const d = new Date(start.getTime() + i * 86400000)
    const y = d.getUTCFullYear()
    if (y !== curYear) {
      curYear = y
      dayOfYear = 0
      yearStart[y - startYear] = i
    }
    dayOfYear++
    year[i] = y
    doy[i] = dayOfYear
    month[i] = d.getUTCMonth() + 1
  }
  const dT = scenario.deltaTempC
  const rf = 1 + scenario.rainChange
  const tmax = c.tmax.map((v) => v + dT)
  const tmin = c.tmin.map((v) => v + dT)
  const qc = qcRain(c.rain, c.start)
  const rain = qc.rain.map((v) => v * rf)
  const et0 = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    et0[i] = et0FromDaily(tmax[i], tmin[i], c.rad[i], c.rh[i], c.wind[i], c.lat, doy[i], elevationM)
  }
  return {
    source,
    lat: c.lat,
    lon: c.lon,
    gridElevationM: c.gridElevationM,
    start: c.start,
    startYear,
    endYear: curYear,
    year,
    doy,
    month,
    tmax,
    tmin,
    rain,
    rad: c.rad,
    rh: c.rh,
    wind: c.wind,
    et0,
    yearStart,
    rainFlags: qc.flags,
    cells: c.cells ?? [{ lat: c.lat, lon: c.lon, elevationM: c.gridElevationM }],
  }
}

/** Global day index for a given calendar year and day-of-year (1-based). -1 if outside the series. */
export function dayIndex(w: WeatherSeries, year: number, doy: number): number {
  const ys = w.yearStart[year - w.startYear]
  if (ys === undefined) return -1
  const i = ys + doy - 1
  return i < w.tmax.length ? i : -1
}

export function isoDate(w: WeatherSeries, index: number): string {
  const d = new Date(new Date(`${w.start}T00:00:00Z`).getTime() + index * 86400000)
  return d.toISOString().slice(0, 10)
}

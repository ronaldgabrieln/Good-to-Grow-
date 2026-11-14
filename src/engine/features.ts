import type { WeatherSeries } from './types'

export interface MonthlyClimate {
  month: number
  rainMeanMm: number
  et0MeanMm: number
  tmaxMean: number
  tminMean: number
  /** Fraction of years with at least one day Tmin ≤ 0 °C in this month. */
  frostProb: number
  /** Mean number of days with Tmax ≥ 35 °C. */
  heatDays: number
  /** Fraction of years with at least 3 days Tmax ≥ 35 °C in this month. */
  heatProb: number
}

export type YearClass = 'dry' | 'typical' | 'wet'

export interface HydroYear {
  /** Hydrological year Oct (y−1) → Sep (y), labeled by y. */
  year: number
  rainMm: number
  et0Mm: number
  tmaxMean: number
  rainClass: YearClass
  hot: boolean
}

export interface ClimateFeatures {
  firstYear: number
  lastYear: number
  nYears: number
  rainMedianMm: number
  rainP10Mm: number
  rainP90Mm: number
  rainySeasonShare: number
  et0AnnualMm: number
  aridityIndex: number
  monthly: MonthlyClimate[]
  frostYears: number
  /** e.g. "last frost after Feb 10 in 3 of 30 years" */
  lastFrostAfter: { date: string; years: number }[]
  heatDaysMedian: number
  gddBase10Median: number
  dryYears: number
  /** Years where Nov–Dec rain < 25 mm (rain-fed cover crop establishment risk). */
  poorFallRainYears: number
  hydroYears: HydroYear[]
  driestYear: HydroYear
  wettestYear: HydroYear
}

function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function doyToLabel(doy: number): string {
  const d = new Date(Date.UTC(2001, 0, doy))
  return `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCDate()}`
}

export function computeFeatures(w: WeatherSeries): ClimateFeatures {
  const years: number[] = []
  for (let y = w.startYear; y <= w.endYear; y++) years.push(y)
  const n = w.tmax.length

  // Calendar-year aggregates.
  const annualRain = new Map<number, number>()
  const annualEt0 = new Map<number, number>()
  const heat = new Map<number, number>()
  const gdd = new Map<number, number>()
  const lastFrostDoy = new Map<number, number>()
  const monthAgg = new Map<string, { rain: number; et0: number; tmax: number; tmin: number; frost: number; heat: number; n: number }>()
  const fallRain = new Map<number, number>()
  let rainySeasonRain = 0
  let totalRain = 0

  for (let i = 0; i < n; i++) {
    const y = w.year[i]
    const m = w.month[i]
    annualRain.set(y, (annualRain.get(y) ?? 0) + w.rain[i])
    annualEt0.set(y, (annualEt0.get(y) ?? 0) + w.et0[i])
    if (w.tmax[i] >= 35) heat.set(y, (heat.get(y) ?? 0) + 1)
    const tmean = (w.tmax[i] + w.tmin[i]) / 2
    gdd.set(y, (gdd.get(y) ?? 0) + Math.max(0, Math.min(30, tmean) - 10))
    if (w.tmin[i] <= 0 && w.doy[i] < 182) lastFrostDoy.set(y, w.doy[i])
    if (m === 11 || m === 12) fallRain.set(y, (fallRain.get(y) ?? 0) + w.rain[i])
    totalRain += w.rain[i]
    if (m >= 11 || m <= 3) rainySeasonRain += w.rain[i]
    const key = `${y}-${m}`
    const a = monthAgg.get(key) ?? { rain: 0, et0: 0, tmax: 0, tmin: 0, frost: 0, heat: 0, n: 0 }
    a.rain += w.rain[i]
    a.et0 += w.et0[i]
    a.tmax += w.tmax[i]
    a.tmin += w.tmin[i]
    if (w.tmin[i] <= 0) a.frost++
    if (w.tmax[i] >= 35) a.heat++
    a.n++
    monthAgg.set(key, a)
  }

  const monthly: MonthlyClimate[] = []
  for (let m = 1; m <= 12; m++) {
    const rows = years.map((y) => monthAgg.get(`${y}-${m}`)).filter((x): x is NonNullable<typeof x> => !!x)
    const k = rows.length
    monthly.push({
      month: m,
      rainMeanMm: rows.reduce((s, r) => s + r.rain, 0) / k,
      et0MeanMm: rows.reduce((s, r) => s + r.et0, 0) / k,
      tmaxMean: rows.reduce((s, r) => s + r.tmax / r.n, 0) / k,
      tminMean: rows.reduce((s, r) => s + r.tmin / r.n, 0) / k,
      frostProb: rows.filter((r) => r.frost > 0).length / k,
      heatDays: rows.reduce((s, r) => s + r.heat, 0) / k,
      heatProb: rows.filter((r) => r.heat >= 3).length / k,
    })
  }

  // Hydrological years (Oct–Sep), the natural unit for winter-rain climates.
  const hydro: HydroYear[] = []
  for (let y = w.startYear + 1; y <= w.endYear; y++) {
    let rain = 0
    let et0 = 0
    let tmax = 0
    let cnt = 0
    for (let i = 0; i < n; i++) {
      const inYear = (w.year[i] === y - 1 && w.month[i] >= 10) || (w.year[i] === y && w.month[i] <= 9)
      if (!inYear) continue
      rain += w.rain[i]
      et0 += w.et0[i]
      tmax += w.tmax[i]
      cnt++
    }
    hydro.push({ year: y, rainMm: rain, et0Mm: et0, tmaxMean: tmax / cnt, rainClass: 'typical', hot: false })
  }
  const rainT1 = quantile(hydro.map((h) => h.rainMm), 1 / 3)
  const rainT2 = quantile(hydro.map((h) => h.rainMm), 2 / 3)
  const hotT = quantile(hydro.map((h) => h.tmaxMean), 2 / 3)
  for (const h of hydro) {
    h.rainClass = h.rainMm < rainT1 ? 'dry' : h.rainMm > rainT2 ? 'wet' : 'typical'
    h.hot = h.tmaxMean > hotT
  }
  const hydroRain = hydro.map((h) => h.rainMm)
  const rainMedian = quantile(hydroRain, 0.5)
  const sortedHydro = [...hydro].sort((a, b) => a.rainMm - b.rainMm)

  // "Last frost after <date> in k of N years" for a few thresholds.
  const frostDoys = [...lastFrostDoy.values()]
  const lastFrostAfter = [15, 32, 46, 60, 74].map((doy) => ({
    date: doyToLabel(doy),
    years: frostDoys.filter((d) => d > doy).length,
  }))

  const et0Median = quantile([...annualEt0.values()], 0.5)
  return {
    firstYear: w.startYear,
    lastYear: w.endYear,
    nYears: years.length,
    rainMedianMm: rainMedian,
    rainP10Mm: quantile(hydroRain, 0.1),
    rainP90Mm: quantile(hydroRain, 0.9),
    rainySeasonShare: totalRain > 0 ? rainySeasonRain / totalRain : 0,
    et0AnnualMm: et0Median,
    aridityIndex: rainMedian / et0Median,
    monthly,
    frostYears: years.filter((y) => monthly && [...Array(12).keys()].some((m) => (monthAgg.get(`${y}-${m + 1}`)?.frost ?? 0) > 0)).length,
    lastFrostAfter,
    heatDaysMedian: quantile(years.map((y) => heat.get(y) ?? 0), 0.5),
    gddBase10Median: quantile(years.map((y) => gdd.get(y) ?? 0), 0.5),
    dryYears: hydro.filter((h) => h.rainMm < 0.6 * rainMedian).length,
    poorFallRainYears: years.filter((y) => (fallRain.get(y) ?? 0) < 25).length,
    hydroYears: hydro,
    driestYear: sortedHydro[0],
    wettestYear: sortedHydro[sortedHydro.length - 1],
  }
}

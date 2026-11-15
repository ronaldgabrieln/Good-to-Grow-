import { CROP_BY_ID, cropDuration } from './crops'
import { dayIndex, isoDate } from './weather'
import type { Crop, FieldInput, PlantingSim, Season, Soil, WeatherSeries } from './types'

/**
 * Simulation context for one field + one climate scenario.
 * Planting simulations are cached by crop/season/year because rotations reuse them heavily.
 */
export interface SimContext {
  w: WeatherSeries
  soil: Soil
  field: FieldInput
  /** RUSLE LS factor for the field. */
  ls: number
  /** Prefix sums over days: bare-soil (C = 1) erosion, t/ha. */
  bareErosionPrefix: Float64Array
  /** Prefix sums: 1 if the day is in the rainy season (Nov–Mar). */
  rainySeasonPrefix: Float64Array
  /** cache.get(`${crop}|${season}`)[year - startYear] */
  cache: Map<string, (PlantingSim | null | undefined)[]>
}

/** RUSLE slope-length/steepness factor (Renard et al. 1997, McCool et al. 1987). */
export function lsFactor(slopePct: number, lengthM: number): number {
  const theta = Math.atan(slopePct / 100)
  const s = Math.sin(theta)
  const m = slopePct >= 5 ? 0.5 : slopePct >= 3 ? 0.4 : slopePct >= 1 ? 0.3 : 0.2
  return Math.pow(lengthM / 22.13, m) * (65.41 * s * s + 4.56 * s + 0.065)
}

/**
 * Daily rainfall erosivity, MJ·mm/(ha·h). Richardson-type power law on erosive days (≥ 12.7 mm).
 * Coefficients are generic; use the result for comparing strategies, not as an absolute soil-loss figure.
 */
export function dailyErosivity(rainMm: number): number {
  return rainMm >= 12.7 ? 0.29 * Math.pow(rainMm, 1.81) : 0
}

export function createContext(w: WeatherSeries, soil: Soil, field: FieldInput): SimContext {
  const ls = lsFactor(field.slopePct, field.slopeLengthM)
  const n = w.rain.length
  const bare = new Float64Array(n + 1)
  const rainy = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    bare[i + 1] = bare[i] + dailyErosivity(w.rain[i]) * soil.kFactor * ls
    const m = w.month[i]
    rainy[i + 1] = rainy[i] + (m >= 11 || m <= 3 ? 1 : 0)
  }
  return { w, soil, field, ls, bareErosionPrefix: bare, rainySeasonPrefix: rainy, cache: new Map() }
}

export function kcOnDay(c: Crop, d: number): number {
  const [ini, dev, mid] = c.stages
  const [kIni, kMid, kEnd] = c.kc
  if (d < ini) return kIni
  if (d < ini + dev) return kIni + ((d - ini) / dev) * (kMid - kIni)
  if (d < ini + dev + mid) return kMid
  const late = c.stages[3]
  return kMid + (Math.min(late, d - ini - dev - mid) / Math.max(1, late)) * (kEnd - kMid)
}

/** FAO-29 leaching requirement and resulting salinity yield factor (Maas–Hoffman). */
export function salinityResponse(c: Crop, ecw: number): { lf: number; factor: number } {
  if (c.irrigation === 'establish' || ecw <= 0) return { lf: 0, factor: 1 }
  const thr = c.salinity.threshold
  const LF_CAP = 0.25
  const need = 5 * thr > ecw ? ecw / (5 * thr - ecw) : Infinity
  if (need <= LF_CAP) return { lf: need, factor: 1 }
  // Leaching capped: root-zone ECe settles where LR equation balances at LF_CAP.
  const ece = (ecw * (1 + LF_CAP)) / (5 * LF_CAP)
  const factor = Math.max(0, 1 - (c.salinity.slope / 100) * Math.max(0, ece - thr))
  return { lf: LF_CAP, factor }
}

/** Temperature suitability of one day: 1 inside ECOCROP optimum ±4 °C, falling to 0 at 8 °C beyond. */
function tempSuitability(c: Crop, tmean: number): number {
  const lo = c.tOpt[0] - 4
  const hi = c.tOpt[1] + 4
  if (tmean >= lo && tmean <= hi) return 1
  const dist = tmean < lo ? lo - tmean : tmean - hi
  return Math.max(0, 1 - dist / 8)
}

/** Cached row of simulations for one crop/season, indexed by year - startYear. */
export function simRow(ctx: SimContext, cropId: string, season: Season): (PlantingSim | null | undefined)[] {
  const key = `${cropId}|${season}`
  let row = ctx.cache.get(key)
  if (!row) {
    row = new Array(ctx.w.endYear - ctx.w.startYear + 1)
    ctx.cache.set(key, row)
  }
  return row
}

export function simulatePlanting(ctx: SimContext, cropId: string, season: Season, year: number): PlantingSim | null {
  const row = simRow(ctx, cropId, season)
  const k = year - ctx.w.startYear
  if (k < 0 || k >= row.length) return null
  let hit = row[k]
  if (hit === undefined) {
    hit = runPlanting(ctx, cropId, season, year)
    row[k] = hit
  }
  return hit
}

/** One simulated day of a planting (reported only to the optional `onDay` hook). */
export interface PlantingDay {
  d: number
  index: number
  et0: number
  kc: number
  etc: number
  eta: number
  rain: number
  /** Root-zone depletion at the end of the day, mm. */
  depletion: number
  /** Readily available water: irrigate (or stress) above this depletion, mm. */
  raw: number
  /** Total available water in the current root zone, mm. */
  taw: number
  /** Net irrigation applied this day, mm. */
  irrigation: number
  rootM: number
  cover: number
  tmax: number
  tmin: number
  erosionT: number
}

/**
 * Re-run one planting with a day-by-day record (behind-the-scenes view). Same math as the cached
 * simulation; the result is not cached.
 */
export function tracePlanting(
  ctx: SimContext,
  cropId: string,
  season: Season,
  year: number,
): { sim: PlantingSim; days: PlantingDay[] } | null {
  const days: PlantingDay[] = []
  const sim = runPlanting(ctx, cropId, season, year, (day) => days.push(day))
  return sim ? { sim, days } : null
}

function runPlanting(
  ctx: SimContext,
  cropId: string,
  season: Season,
  year: number,
  onDay?: (day: PlantingDay) => void,
): PlantingSim | null {
  const { w, soil, field } = ctx
  const c = CROP_BY_ID[cropId]
  const plantDoy = c?.plant[season]
  if (!c || plantDoy === undefined) return null
  const start = dayIndex(w, year, plantDoy)
  const dur = cropDuration(c)
  if (start < 0 || start + dur > w.tmax.length) return null

  const [ini, dev, mid] = c.stages
  const zMin = 0.15
  const awc = soil.awcMmPerM
  let zr = zMin
  let taw = awc * zr
  let dr = 0.5 * taw
  let irrNet = 0
  let etc = 0
  let eta = 0
  let rain = 0
  let heatDays = 0
  let frostKill = false
  let frostDay: string | undefined
  let tempSum = 0
  let erosion = 0

  if (c.irrigation === 'establish') {
    const est = 25
    irrNet += est
    dr = Math.max(0, dr - est)
  }

  for (let d = 0; d < dur; d++) {
    const i = start + d
    // Root growth (FAO-56): linear to max depth at end of development.
    const zNew = zMin + (c.rootDepthM - zMin) * Math.min(1, d / (ini + dev))
    if (zNew > zr) {
      const tawNew = awc * zNew
      dr += (tawNew - taw) * 0.5 // newly explored soil assumed half-depleted
      taw = tawNew
      zr = zNew
    }
    const raw = c.p * taw
    const kc = kcOnDay(c, d)
    const etcDay = kc * w.et0[i]
    const ks = dr > raw ? Math.max(0, (taw - dr) / ((1 - c.p) * taw)) : 1
    const etaDay = ks * etcDay
    const p = w.rain[i]
    dr = dr - p + etaDay
    if (dr < 0) dr = 0
    let irrToday = 0
    if (c.irrigation === 'full' && dr > raw) {
      irrToday = dr
      irrNet += dr
      dr = 0
    }
    etc += etcDay
    eta += etaDay
    rain += p

    const tmean = (w.tmax[i] + w.tmin[i]) / 2
    tempSum += tempSuitability(c, tmean)
    if (d >= ini + dev && d < ini + dev + mid && w.tmax[i] >= c.heatStressC) heatDays++
    if (d >= 7 && !frostKill && w.tmin[i] <= c.frostKillC) {
      frostKill = true
      frostDay = isoDate(w, i)
    }
    const cover = c.maxCover * Math.min(1, d / (ini + dev))
    const erosionDay = dailyErosivity(p) * soil.kFactor * ctx.ls * (1 - 0.9 * cover)
    erosion += erosionDay
    onDay?.({
      d,
      index: i,
      et0: w.et0[i],
      kc,
      etc: etcDay,
      eta: etaDay,
      rain: p,
      depletion: dr,
      raw,
      taw,
      irrigation: irrToday,
      rootM: zr,
      cover,
      tmax: w.tmax[i],
      tmin: w.tmin[i],
      erosionT: erosionDay,
    })
  }

  const sal = salinityResponse(c, field.wellEcDsM)
  const waterStressFactor = etc > 0 ? eta / etc : 1
  const tempFit = tempSum / dur
  const heatFactor = Math.max(0.5, 1 - 0.03 * heatDays)
  const frostFactor = frostKill ? 0.3 : 1
  const tempFactor = 0.5 + 0.5 * tempFit
  const waterFactor = c.irrigation === 'establish' ? waterStressFactor : 1
  const yieldFactor = sal.factor * heatFactor * frostFactor * tempFactor * waterFactor
  const irrigationGrossMm = irrNet / Math.max(0.3, field.irrigationEfficiency) / (1 - sal.lf)

  return {
    cropId,
    season,
    year,
    startIndex: start,
    endIndex: start + dur,
    etcMm: etc,
    rainMm: rain,
    irrigationGrossMm,
    leachingFraction: sal.lf,
    waterStressFactor,
    frostKill,
    frostDay,
    heatDays,
    tempFit,
    salinityFactor: sal.factor,
    yieldFactor,
    erosionT: erosion,
    failed: c.kind !== 'cover' && yieldFactor < 0.6,
  }
}

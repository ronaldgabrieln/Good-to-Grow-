import { CROPS, CROP_BY_ID, cropDuration } from './crops'
import { simRow, simulatePlanting, type SimContext } from './simulate'
import { dayIndex } from './weather'
import type { CropEventSummary, PlantingSim, PlantingWindow, RotationMetrics, Season, Slots } from './types'

export const ROTATION_YEARS = 3
export const SLOT_COUNT = ROTATION_YEARS * 2

export const seasonOf = (slot: number): Season => (slot % 2 === 0 ? 'A' : 'B')
export const yearOf = (slot: number): number => Math.floor(slot / 2)

/** Human-readable agronomic rules applied by the generator (shown in the UI). */
export const RULES = [
  'Each crop is planted only in its local season window (Maneadero planting dates).',
  'A crop must be harvested before the next one is planted; long crops (strawberry, alfalfa) block the following slots.',
  'The same crop never follows itself, and cash crops of the same plant family never follow each other.',
  'Families should not return sooner than their break interval (e.g. Solanaceae 3 years); shorter returns are penalized.',
  'The field must carry a cash or forage crop for at least 60 days in every year of the rotation.',
  'Shortlisted alternatives keep at least half of your current income index (livelihood guard).',
]

export function windowsOf(slots: Slots): PlantingWindow[] {
  const out: PlantingWindow[] = []
  slots.forEach((id, slot) => {
    if (!id) return
    const c = CROP_BY_ID[id]
    const doy = c?.plant[seasonOf(slot)]
    if (!c || doy === undefined) return
    const startDay = yearOf(slot) * 365 + doy - 1
    out.push({ slot, cropId: id, startDay, endDay: startDay + cropDuration(c) })
  })
  return out
}

export interface Validity {
  ok: boolean
  reasons: string[]
}

/** Hard-rule check. `cyclic` = also check the wrap from the last slot back to year 1. */
export function checkRotation(slots: Slots, cyclic = true): Validity {
  const reasons: string[] = []
  slots.forEach((id, slot) => {
    if (!id) return
    const c = CROP_BY_ID[id]
    if (!c) reasons.push(`Unknown crop "${id}"`)
    else if (c.plant[seasonOf(slot)] === undefined)
      reasons.push(`${c.name} is not planted in ${seasonOf(slot) === 'A' ? 'spring' : 'fall'} here`)
  })
  const wins = windowsOf(slots)
  const years = slots.length / 2
  const pairs: [PlantingWindow, PlantingWindow, number][] = []
  for (let k = 0; k + 1 < wins.length; k++) pairs.push([wins[k], wins[k + 1], 0])
  if (cyclic && wins.length > 1) pairs.push([wins[wins.length - 1], wins[0], years * 365])
  for (const [a, b, shift] of pairs) {
    const ca = CROP_BY_ID[a.cropId]
    const cb = CROP_BY_ID[b.cropId]
    if (a.endDay > b.startDay + shift) reasons.push(`${ca.name} is still in the field when ${cb.name} should be planted`)
    if (a.cropId === b.cropId) reasons.push(`${ca.name} follows itself`)
    else if (ca.family === cb.family && ca.kind !== 'cover' && cb.kind !== 'cover')
      reasons.push(`${ca.name} and ${cb.name} are both ${ca.family} back to back`)
  }
  if (cyclic) {
    for (let y = 0; y < years; y++) {
      const lo = y * 365
      const hi = lo + 365
      let days = 0
      for (const win of wins) {
        if (CROP_BY_ID[win.cropId].kind === 'cover') continue
        for (const shift of [0, years * 365]) {
          days += Math.max(0, Math.min(hi, win.endDay - shift) - Math.max(lo, win.startDay - shift))
        }
      }
      if (days < 60) reasons.push(`Year ${y + 1} has no cash or forage crop`)
    }
  }
  return { ok: reasons.length === 0, reasons }
}

interface PestResult {
  score: number
  notes: string[]
}

/** Pest & disease break quality, 0–100. Rule-based on plant families and return intervals. */
export function pestAnalysis(slots: Slots, cyclic = true): PestResult {
  const wins = windowsOf(slots)
  const years = slots.length / 2
  const period = years * 365
  const notes: string[] = []
  let score = 85
  const cash = wins.filter((w) => CROP_BY_ID[w.cropId].kind !== 'cover')
  // Return intervals within the cycle.
  const seenPairs = new Set<string>()
  for (let i = 0; i < cash.length; i++) {
    for (let j = 0; j < cash.length; j++) {
      if (i === j) continue
      const a = CROP_BY_ID[cash[i].cropId]
      const b = CROP_BY_ID[cash[j].cropId]
      if (a.family !== b.family) continue
      let gap = cash[j].startDay - cash[i].endDay
      if (gap < 0) {
        if (!cyclic) continue
        gap += period
      }
      const key = [i, j].sort().join('-')
      if (seenPairs.has(key)) continue
      seenPairs.add(key)
      const needed = a.returnYears * 365 - 120
      if (gap < needed) {
        const penalty = a.returnYears >= 3 ? 18 : 10
        score -= penalty
        notes.push(`${a.family} returns after ~${Math.max(0, gap / 365).toFixed(1)} yr (${a.name} → ${b.name}); recommended break is ${a.returnYears} yr`)
      }
    }
    // Single-family crops in a 3-year cycle repeat every cycle: penalize if the cycle is shorter than the break.
  }
  for (const w of cash) {
    const c = CROP_BY_ID[w.cropId]
    const sameFamily = cash.filter((x) => CROP_BY_ID[x.cropId].family === c.family).length
    if (cyclic && sameFamily === 1 && c.returnYears > years) {
      score -= 8
      notes.push(`${c.name} returns every ${years} yr; ${c.returnYears} yr break is recommended`)
    }
  }
  // Covers that host the same family as the next cash crop act as a "green bridge".
  for (let k = 0; k < wins.length; k++) {
    const a = CROP_BY_ID[wins[k].cropId]
    const next = wins[k + 1] ?? (cyclic ? wins[0] : undefined)
    if (!next) continue
    const b = CROP_BY_ID[next.cropId]
    if (a.kind === 'cover' && a.family === b.family) {
      score -= 5
      notes.push(`${a.name} is the same family as the following ${b.name} (possible green bridge)`)
    }
    if (a.biofumigant && (b.family === 'Solanaceae' || b.family === 'Cucurbitaceae')) {
      score += 6
      notes.push(`${a.name} before ${b.name} may suppress soil-borne disease`)
    }
  }
  const families = new Set(wins.map((w) => CROP_BY_ID[w.cropId].family))
  const diversityBonus = Math.max(0, families.size - 3) * 4
  score += diversityBonus
  if (diversityBonus > 0) notes.push(`${families.size} plant families in the rotation`)
  return { score: Math.max(0, Math.min(100, score)), notes }
}

export interface Evaluation {
  metrics: RotationMetrics
  events: CropEventSummary[]
  windows: PlantingWindow[]
}

const HUMIFICATION = 0.15 // fraction of residue C that becomes soil organic C (assumed, typical 0.1–0.2)
const CARBON_FRACTION = 0.45

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

/**
 * Replay a rotation through every possible start year of the weather record.
 * Each "cycle" = the rotation started in year y and grown for its full length against y, y+1, y+2 weather.
 */
export function evaluateRotation(ctx: SimContext, slots: Slots, cyclic = true): Evaluation | null {
  const windows = windowsOf(slots)
  if (windows.length === 0) return null
  const years = Math.max(1, Math.ceil(slots.length / 2))
  const { w } = ctx
  const lastStart = w.endYear - years // need one extra year for crops running past Dec 31
  const perCycleWater: number[] = []
  const perCycleIncome: number[] = []
  let waterSum = 0
  let incomeSum = 0
  let residueSum = 0
  let erosionSum = 0
  let bareSum = 0
  let bareRainySum = 0
  let failedCycles = 0
  let cycles = 0
  const ev = windows.map((win) => ({
    cropId: win.cropId,
    slot: win.slot,
    yearsReplayed: 0,
    frostYears: 0,
    heatYears: 0,
    failedYears: 0,
    yfSum: 0,
    salinityFactor: 1,
    leachingFraction: 0,
    irrSum: 0,
  }))

  const rows = windows.map((win) => simRow(ctx, win.cropId, seasonOf(win.slot)))
  for (let y0 = w.startYear; y0 <= lastStart; y0++) {
    const sims: PlantingSim[] = []
    let ok = true
    for (let k = 0; k < windows.length; k++) {
      const win = windows[k]
      const yi = y0 + yearOf(win.slot) - w.startYear
      const cached = rows[k][yi]
      const s = cached !== undefined ? cached : simulatePlanting(ctx, win.cropId, seasonOf(win.slot), y0 + yearOf(win.slot))
      if (!s) {
        ok = false
        break
      }
      sims.push(s)
    }
    if (!ok) continue
    cycles++
    let water = 0
    let income = 0
    let failed = false
    sims.forEach((s, k) => {
      const c = CROP_BY_ID[s.cropId]
      water += s.irrigationGrossMm
      income += c.marketIndex * s.yieldFactor
      residueSum += c.residueT * s.yieldFactor
      erosionSum += s.erosionT
      if (s.failed) failed = true
      const e = ev[k]
      e.yearsReplayed++
      if (s.frostKill) e.frostYears++
      if (s.heatDays >= 3) e.heatYears++
      if (s.failed) e.failedYears++
      e.yfSum += s.yieldFactor
      e.salinityFactor = s.salinityFactor
      e.leachingFraction = s.leachingFraction
      e.irrSum += s.irrigationGrossMm
    })
    // Bare-soil gaps between consecutive plantings (and the wrap into the next cycle).
    const gapPairs: [number, number][] = []
    for (let k = 0; k + 1 < sims.length; k++) gapPairs.push([sims[k].endIndex, sims[k + 1].startIndex])
    if (cyclic) {
      const first = windows[0]
      const c0 = CROP_BY_ID[first.cropId]
      const nextStart = dayIndex(w, y0 + years + yearOf(first.slot), c0.plant[seasonOf(first.slot)]!)
      if (nextStart > 0) gapPairs.push([sims[sims.length - 1].endIndex, nextStart])
    }
    for (const [a, b] of gapPairs) {
      if (b <= a) continue
      erosionSum += ctx.bareErosionPrefix[b] - ctx.bareErosionPrefix[a]
      bareSum += b - a
      bareRainySum += ctx.rainySeasonPrefix[b] - ctx.rainySeasonPrefix[a]
    }
    if (failed) failedCycles++
    waterSum += water
    incomeSum += income
    perCycleWater.push(water / years)
    perCycleIncome.push(income / years)
  }
  if (cycles === 0) return null

  // Nitrogen: legume credits pass to the next planting (cyclic).
  let nNeed = 0
  windows.forEach((win, k) => {
    const c = CROP_BY_ID[win.cropId]
    const prevIdx = k === 0 ? (cyclic ? windows.length - 1 : -1) : k - 1
    let credit = 0
    if (prevIdx >= 0 && prevIdx !== k) {
      const prev = CROP_BY_ID[windows[prevIdx].cropId]
      const yf = ev[prevIdx].yfSum / Math.max(1, ev[prevIdx].yearsReplayed)
      credit = prev.nCreditKg * Math.min(1, yf)
    }
    nNeed += Math.max(0, c.nDemandKg - credit)
  })

  const pest = pestAnalysis(slots, cyclic)
  const perYear = cycles * years
  const residuePerYear = residueSum / perYear
  const metrics: RotationMetrics = {
    waterMm: waterSum / perYear,
    waterDryYearMm: quantile(perCycleWater, 0.9),
    income: incomeSum / perYear,
    incomeLowYear: quantile(perCycleIncome, 0.1),
    soilCarbon: residuePerYear * CARBON_FRACTION * HUMIFICATION,
    residueT: residuePerYear,
    nitrogenKg: nNeed / years,
    erosionT: erosionSum / perYear,
    bareRainyDays: bareRainySum / perYear,
    bareDays: bareSum / perYear,
    pestScore: pest.score,
    pestNotes: pest.notes,
    failureRisk: failedCycles / cycles,
    cyclesReplayed: cycles,
  }
  const events: CropEventSummary[] = ev.map((e) => ({
    cropId: e.cropId,
    slot: e.slot,
    yearsReplayed: e.yearsReplayed,
    frostYears: e.frostYears,
    heatYears: e.heatYears,
    failedYears: e.failedYears,
    meanYieldFactor: e.yfSum / Math.max(1, e.yearsReplayed),
    salinityFactor: e.salinityFactor,
    leachingFraction: e.leachingFraction,
    meanIrrigationMm: e.irrSum / Math.max(1, e.yearsReplayed),
  }))
  return { metrics, events, windows }
}

/** Canonical key so the same rotation started in a different year is treated as identical. */
export function canonicalKey(slots: Slots): string {
  const years = slots.length / 2
  const keys: string[] = []
  for (let s = 0; s < years; s++) {
    const shifted = [...slots.slice(s * 2), ...slots.slice(0, s * 2)]
    keys.push(shifted.map((x) => x ?? '-').join(','))
  }
  return keys.sort()[0]
}

export function candidatesForSlot(slot: number): (string | null)[] {
  const season = seasonOf(slot)
  return [null, ...CROPS.filter((c) => c.plant[season] !== undefined).map((c) => c.id)]
}

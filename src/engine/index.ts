// Public API of the rotation decision engine.
//
//   const data = await loadFieldData(field)                    // NASA POWER + SoilGrids (live → cache → demo)
//   const result = runEngine({ data, field, scenario, priorities, current })
//
// `result.strategies[0]` is always the farmer's current rotation; the rest are the top alternatives.
// Everything is plain JSON-serializable data, so map / 3D views can consume it directly.

import { CROP_BY_ID } from './crops'
import { buildCard, rotationLabel } from './explain'
import { computeFeatures, type ClimateFeatures } from './features'
import { canonicalKey, checkRotation, evaluateRotation, RULES, type Evaluation } from './rotation'
import { generateCandidates, hamming, neighborhood, PRIORITY_KEYS, rotationDistance, scorePool } from './score'
import { createContext } from './simulate'
import type { FieldData } from './load'
import { prepareWeather } from './weather'
import type { FieldInput, Priorities, PriorityKey, Scenario, Slots, Soil, Strategy, StrategyType, WeatherSeries } from './types'

export * from './types'
export { CROPS, CROP_BY_ID, DEFAULT_CURRENT, SOURCES, cropDuration } from './crops'
export { loadFieldData, loadDemoData, type FieldData, type LoadStep } from './load'
export { ANALYSIS_START_YEAR, ANALYSIS_END_YEAR } from './weather'
export { PRIORITY_KEYS, PRIORITY_LABELS } from './score'
export { RULES, checkRotation, seasonOf, yearOf, SLOT_COUNT } from './rotation'
export { slotLabel, rotationLabel } from './explain'
export type { ClimateFeatures } from './features'

export interface EngineInput {
  data: FieldData
  field: FieldInput
  scenario: Scenario
  priorities: Priorities
  current: Slots
  alternatives?: number
}

/** Weather metadata only (the daily arrays stay inside the engine / worker). */
export type WeatherMeta = Pick<
  WeatherSeries,
  'source' | 'lat' | 'lon' | 'gridElevationM' | 'startYear' | 'endYear' | 'rainFlags' | 'cells'
>

export interface EngineResult {
  weather: WeatherMeta
  soil: Soil
  features: ClimateFeatures
  strategies: Strategy[]
  currentValidity: { ok: boolean; reasons: string[] }
  poolSize: number
  rules: string[]
  elapsedMs: number
}

export const DEFAULT_FIELD: FieldInput = {
  name: 'Maneadero valley, Ensenada, B.C.',
  lat: 31.69,
  lon: -116.57,
  elevationM: 20,
  slopePct: 1.5,
  slopeLengthM: 100,
  wellEcDsM: 1.5,
  irrigationEfficiency: 0.9,
}

export const DEFAULT_PRIORITIES: Priorities = {
  water: 5,
  income: 4,
  soil: 3,
  nitrogen: 2,
  erosion: 2,
  pest: 3,
  risk: 3,
}

export const DEFAULT_SCENARIO: Scenario = { deltaTempC: 0, rainChange: 0 }

/** Shortlisted alternatives must keep at least this share of the current income index. */
export const INCOME_FLOOR = 0.5

export function runEngine(input: EngineInput): EngineResult {
  const t0 = performance.now()
  const { data, field, scenario, priorities } = input
  const nAlt = input.alternatives ?? 3
  const weather = prepareWeather(data.power, data.source, field.elevationM, scenario)
  const features = computeFeatures(weather)
  const ctx = createContext(weather, data.soil, field)

  const current = input.current
  const currentValidity = checkRotation(current, true)
  const currentEv = evaluateRotation(ctx, current, true)

  const pool = [...generateCandidates(ctx, priorities), ...neighborhood(ctx, current, 2)]
  const currentKey = canonicalKey(current)
  const unique = new Map<string, { slots: Slots; ev: Evaluation }>()
  for (const p of pool) {
    const k = canonicalKey(p.slots)
    if (k !== currentKey && !unique.has(k)) unique.set(k, p)
  }
  const candidates = [...unique.values()]
  const all = currentEv ? [{ slots: current, ev: currentEv }, ...candidates] : candidates
  const { scores, totals } = scorePool(
    all.map((x) => x.ev.metrics),
    priorities,
  )
  const offset = currentEv ? 1 : 0
  const order = candidates.map((_, i) => i + offset).sort((a, b) => totals[b] - totals[a])
  const rankOf = new Map(order.map((i, r) => [i, r + 1]))

  // Shortlist: a small change to what the farmer does now, the best match, and a different approach.
  const picks: { i: number; type: StrategyType }[] = []
  const distinct = (i: number, minDist: number) => picks.every((p) => rotationDistance(all[i].slots, all[p.i].slots) >= minDist)
  const farFromCurrent = (i: number, d: number) => !currentEv || rotationDistance(all[i].slots, current) >= d
  const small = order.find((i) => hamming(all[i].slots, current) <= 2 && (!currentEv || totals[i] > totals[0]))
  if (small !== undefined) picks.push({ i: small, type: 'small-change' })
  // Livelihood guard: shortlisted alternatives keep at least half of the current income index.
  const minIncome = currentEv ? INCOME_FLOOR * currentEv.metrics.income : -Infinity
  const viable = (i: number) => all[i].ev.metrics.income >= minIncome
  const best =
    order.find((i) => viable(i) && distinct(i, 3) && farFromCurrent(i, 3)) ??
    order.find((i) => distinct(i, 3) && farFromCurrent(i, 3))
  if (best !== undefined) picks.push({ i: best, type: 'best' })
  for (const pass of [true, false]) {
    for (const i of order) {
      if (picks.length >= nAlt) break
      if ((!pass || viable(i)) && distinct(i, 4) && farFromCurrent(i, 3)) picks.push({ i, type: 'different' })
    }
  }
  const shown: { i: number; type: StrategyType }[] = currentEv ? [{ i: 0, type: 'current' }, ...picks] : picks

  // "Best at" tags among the strategies shown side by side.
  const bestAt = new Map<number, PriorityKey[]>()
  for (const k of PRIORITY_KEYS) {
    let top = shown[0].i
    for (const { i } of shown) if (scores[i][k] > scores[top][k] + 1e-9) top = i
    if (shown.filter(({ i }) => Math.abs(scores[i][k] - scores[top][k]) < 1e-9).length === 1)
      bestAt.set(top, [...(bestAt.get(top) ?? []), k])
  }

  const currentMetrics = currentEv?.metrics ?? all[picks[0]?.i]?.ev.metrics
  const strategies: Strategy[] = shown.map(({ i, type }) => {
    const { slots, ev } = all[i]
    const isCurrent = type === 'current'
    const rank = isCurrent ? 0 : (rankOf.get(i) ?? 0)
    return {
      type,
      rank,
      rotation: {
        id: canonicalKey(slots),
        label: rotationLabel(slots),
        slots,
        isCurrent,
      },
      windows: ev.windows,
      metrics: ev.metrics,
      scores: scores[i],
      total: totals[i],
      events: ev.events,
      card: buildCard({
        slots,
        type,
        metrics: ev.metrics,
        scores: scores[i],
        events: ev.events,
        rank,
        poolSize: candidates.length,
        isCurrent,
        current: { slots: current, metrics: currentMetrics },
        priorities,
        features,
        weather,
        soil: data.soil,
        field,
        bestAt: bestAt.get(i) ?? [],
      }),
    }
  })

  const { source, lat, lon, gridElevationM, startYear, endYear, rainFlags, cells } = weather
  return {
    weather: { source, lat, lon, gridElevationM, startYear, endYear, rainFlags, cells },
    soil: data.soil,
    features,
    strategies,
    currentValidity,
    poolSize: candidates.length,
    rules: RULES,
    elapsedMs: performance.now() - t0,
  }
}

/** Crop names for a slot array, for logging / debugging. */
export function describeSlots(slots: Slots): string {
  return slots.map((id) => (id ? CROP_BY_ID[id].name : '—')).join(' | ')
}

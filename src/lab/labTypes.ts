// Shared message and result shapes for the behind-the-scenes view and its worker.
import type { ClimateFeatures, EngineInput, EngineResult } from '../engine'
import type { PlantingDay } from '../engine/simulate'
import type { RainFlag } from '../engine/weather'
import type { PlantingSim, Season, Slots, Soil } from '../engine/types'

/** Outcome codes in the combinations timeline (index = code). */
export const OUTCOMES = ['duplicate', 'rule', 'no-sim', 'pruned', 'kept', 'added'] as const
export type OutcomeCode = 0 | 1 | 2 | 3 | 4 | 5
export const OUTCOME_LABEL: Record<(typeof OUTCOMES)[number], string> = {
  duplicate: 'Duplicate (already tried)',
  rule: 'Broke a rule',
  'no-sim': 'Nothing to grow',
  pruned: 'Valid, scored too low',
  kept: 'Kept by the beam',
  added: 'Valid tweak, added to pool',
}

/**
 * Every combination the generator tried, in the order it tried them. Column arrays keep this
 * small enough to post from the worker (tens of thousands of rows).
 */
export interface Timeline {
  n: number
  /** 0 = beam search, 1 = neighbourhood (tweaks of the current rotation). */
  phase: Uint8Array
  /** Beam: slot being filled (0–5). Neighbourhood: number of slots changed (1–2). */
  depth: Uint8Array
  outcome: Uint8Array
  /** 6 crop indices per row into CROPS; -1 = empty slot, -2 = not decided yet (partial). */
  slots: Int16Array
  /** Index into `reasons` for rule failures, else -1. */
  reason: Int16Array
  reasons: string[]
  /** Wall time when the row was tried, ms since generation started. */
  t: Float32Array
}

export interface PoolPoints {
  /** Rows of [irrigation mm/yr, income index, total score, from beam (1) or tweaks (0)]; row 0 = current rotation. */
  points: Float32Array
  count: number
  beamOut: number
  neighborhoodOut: number
}

export interface WeatherView {
  start: string
  startYear: number
  endYear: number
  yearStart: number[]
  cells: { lat: number; lon: number; elevationM: number }[]
  gridElevationM: number
  rainFlags: RainFlag[]
  tmax: Float32Array
  tmin: Float32Array
  rain: Float32Array
  rad: Float32Array
  rh: Float32Array
  wind: Float32Array
  et0: Float32Array
}

export interface StageTime {
  stage: string
  ms: number
  detail: string
}

export interface LabResult {
  weather: WeatherView
  features: ClimateFeatures
  soil: Soil
  ls: number
  timeline: Timeline
  pool: PoolPoints
  engine: EngineResult
  stages: StageTime[]
}

export interface ReplayRow {
  startYear: number
  waterMm: number
  income: number
  failed: boolean
  plantings: { cropId: string; slot: number; year: number; yieldFactor: number; irrigationMm: number; frostKill: boolean; heatDays: number }[]
}

export interface PlantingTrace {
  sim: PlantingSim
  days: PlantingDay[]
}

/** Follow-up questions the page asks the worker after a run (answered from its kept context). */
export type LabQuery =
  | { kind: 'replay'; slots: Slots }
  | { kind: 'trace'; cropId: string; season: Season; year: number }

export type LabRequest = { kind: 'run'; id: number; input: EngineInput } | (LabQuery & { id: number })

export type LabResponse =
  | { kind: 'stage'; id: number; stage: StageTime }
  | { kind: 'result'; id: number; result: LabResult }
  | { kind: 'replay'; id: number; rows: ReplayRow[] }
  | { kind: 'trace'; id: number; trace: PlantingTrace | null }
  | { kind: 'error'; id: number; error: string }

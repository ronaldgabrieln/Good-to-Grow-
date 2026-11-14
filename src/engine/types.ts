// Shared types for the rotation decision engine.
// Contract for teammates: UI / map / 3D views consume `EngineResult` (see index.ts).

/** Where a number comes from. Shown as a badge next to every number in the UI. */
export type Provenance = 'observed' | 'modeled' | 'assumed'

export interface WeatherSeries {
  source: 'live' | 'demo' | 'cache'
  lat: number
  lon: number
  gridElevationM: number
  /** ISO date of index 0 (always Jan 1). */
  start: string
  startYear: number
  endYear: number
  /** Parallel daily arrays. */
  year: number[]
  doy: number[]
  month: number[] // 1..12
  tmax: number[]
  tmin: number[]
  rain: number[]
  rad: number[] // MJ/m²/day
  rh: number[] // %
  wind: number[] // m/s at 2 m
  /** Daily reference evapotranspiration (FAO-56 Penman-Monteith), mm. Filled by prepareWeather. */
  et0: number[]
  /** Index of Jan 1 of each year: yearStart[y - startYear]. */
  yearStart: number[]
  /** Rain spells removed by quality control (see weather.qcRain). */
  rainFlags: { start: string; end: string; totalMm: number; peakMm: number }[]
  /** POWER grid cells averaged for this field. */
  cells: { lat: number; lon: number; elevationM: number }[]
}

export interface Soil {
  source: 'soilgrids' | 'default'
  sandPct: number
  clayPct: number
  siltPct: number
  socGkg: number // topsoil 0–30 cm average
  ph: number
  textureClass: string
  /** Volumetric water content at field capacity / wilting point (m³/m³), Saxton & Rawls 2006. */
  thetaFC: number
  thetaWP: number
  /** Available water capacity, mm of water per m of soil. */
  awcMmPerM: number
  /** RUSLE soil erodibility K (t·ha·h / ha·MJ·mm), EPIC equation. */
  kFactor: number
}

export interface FieldInput {
  name: string
  lat: number
  lon: number
  elevationM: number
  slopePct: number
  slopeLengthM: number
  /** Irrigation water salinity, dS/m. Maneadero wells are affected by seawater intrusion. */
  wellEcDsM: number
  /** Irrigation system efficiency (0–1). Drip ≈ 0.9, furrow ≈ 0.6. */
  irrigationEfficiency: number
}

export interface Scenario {
  /** Temperature shift applied to Tmax and Tmin, °C. */
  deltaTempC: number
  /** Rainfall change, fraction (−0.2 = 20 % less rain). */
  rainChange: number
}

export type PriorityKey = 'water' | 'income' | 'soil' | 'nitrogen' | 'erosion' | 'pest' | 'risk'
export type Priorities = Record<PriorityKey, number>

export type Season = 'A' | 'B'
export type CropKind = 'cash' | 'cover' | 'forage'

export interface Crop {
  id: string
  name: string
  nameEs: string
  family: string
  kind: CropKind
  /** Planting day-of-year per season slot. A = spring/summer, B = fall/winter. */
  plant: Partial<Record<Season, number>>
  /** FAO-56 stage lengths: initial, development, mid, late (days). */
  stages: [number, number, number, number]
  /** FAO-56 crop coefficients: Kc ini, Kc mid, Kc end. */
  kc: [number, number, number]
  rootDepthM: number
  /** FAO-56 soil-water depletion fraction before stress. */
  p: number
  maxCover: number
  /** Optimal mean-temperature range, °C (ECOCROP, approximate). */
  tOpt: [number, number]
  /** Tmin at or below which the crop is damaged/killed after emergence. */
  frostKillC: number
  /** Tmax at or above which flowering/fruit set (mid-season) is stressed. */
  heatStressC: number
  /** Maas–Hoffman salinity threshold (ECe, dS/m) and % yield loss per dS/m above it. */
  salinity: { threshold: number; slope: number; estimated?: boolean }
  /** Typical N fertilizer need, kg N/ha per planting. */
  nDemandKg: number
  /** N credit to the following crop, kg N/ha (legumes). */
  nCreditKg: number
  /** Dry residue returned to the soil, t/ha. */
  residueT: number
  /** Relative gross-margin index per planting (placeholder: replace with local prices). */
  marketIndex: number
  irrigation: 'full' | 'establish'
  /** Recommended years before the same family returns (pest/disease break). */
  returnYears: number
  biofumigant?: boolean
  notes?: string
}

/** Result of growing one crop in one season of one historical year. */
export interface PlantingSim {
  cropId: string
  season: Season
  year: number
  startIndex: number
  endIndex: number
  etcMm: number
  rainMm: number
  irrigationGrossMm: number
  leachingFraction: number
  waterStressFactor: number
  frostKill: boolean
  frostDay?: string
  heatDays: number
  tempFit: number
  salinityFactor: number
  yieldFactor: number
  erosionT: number
  failed: boolean
}

/** A rotation is 6 season slots over 3 years: [Y1A, Y1B, Y2A, Y2B, Y3A, Y3B]. null = nothing new planted. */
export type Slots = (string | null)[]

export type StrategyType = 'current' | 'small-change' | 'best' | 'different'

export interface Rotation {
  id: string
  label: string
  slots: Slots
  isCurrent?: boolean
}

export interface PlantingWindow {
  slot: number
  cropId: string
  /** Day offsets from Jan 1 of rotation year 1. */
  startDay: number
  endDay: number
}

export interface CropEventSummary {
  cropId: string
  slot: number
  yearsReplayed: number
  frostYears: number
  heatYears: number
  failedYears: number
  meanYieldFactor: number
  salinityFactor: number
  leachingFraction: number
  meanIrrigationMm: number
}

export interface RotationMetrics {
  /** Gross irrigation water, mm/yr (mean over replayed years). 1 mm on 1 ha = 10 m³. */
  waterMm: number
  waterDryYearMm: number
  /** Relative income index per year. */
  income: number
  incomeLowYear: number
  /** Humified carbon input, t C/ha/yr (soil organic matter building). */
  soilCarbon: number
  residueT: number
  /** Synthetic N needed after legume credits, kg N/ha/yr. */
  nitrogenKg: number
  /** Modeled soil loss, t/ha/yr (simplified RUSLE). */
  erosionT: number
  /** Bare-soil days during the rainy season (Nov–Mar), per year. */
  bareRainyDays: number
  bareDays: number
  /** 0–100: pest/disease break quality. */
  pestScore: number
  pestNotes: string[]
  /** Fraction of replayed rotation cycles with at least one failed cash crop. */
  failureRisk: number
  cyclesReplayed: number
}

export type CriterionScores = Record<PriorityKey, number>

export interface EvidenceItem {
  text: string
  source: string
  provenance: Provenance
}

export interface StrategyCard {
  headline: string
  why: string[]
  evidence: EvidenceItem[]
  benefits: string[]
  tradeoffs: string[]
  risks: string[]
  gaps: string[]
  extension: string
  bestAt: PriorityKey[]
}

export interface Strategy {
  type: StrategyType
  /** Rank among all generated rotations for the farmer's priorities (0 for current). */
  rank: number
  rotation: Rotation
  windows: PlantingWindow[]
  metrics: RotationMetrics
  scores: CriterionScores
  total: number
  events: CropEventSummary[]
  card: StrategyCard
}

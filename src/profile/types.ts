// Farmer profiles: what is stored in Supabase (see supabase/schema.sql).
import type { PlanKey } from '../agent/toolDefs'
import type { FieldInput, Priorities, RotationMetrics, Scenario, Slots, StrategyCard } from '../engine'

export interface Profile {
  id: string
  username: string
  created_at: string
}

/**
 * A saved strategy: a snapshot of one plan with everything needed to explain it (PDF, the helper)
 * and to reopen it (location, crops, priorities, climate test). Stored as `payload` jsonb.
 */
export interface SavedStrategyPayload {
  version: 1
  savedAt: string
  field: FieldInput
  /** What the farmer said they plant now (the comparison baseline). */
  current: Slots
  priorities: Priorities
  scenario: Scenario
  plan: {
    key: PlanKey
    title: string
    slots: Slots
    label: string
    /** "yours" only: the option it was edited from, and which seasons changed. */
    fromKey?: Exclude<PlanKey, 'yours'>
    fromTitle?: string
    edits?: string[]
    metrics: RotationMetrics
    /** The current rotation's metrics under the same weather, for "uses X% less water". */
    baseMetrics: RotationMetrics | null
    /** Engine card text (why, risks, ...), when the plan is one of the engine's options. */
    card: Pick<StrategyCard, 'headline' | 'why' | 'benefits' | 'tradeoffs' | 'risks' | 'gaps' | 'extension'> | null
    problems: string[]
  }
  soil: { source: string; texture: string; sandPct: number; clayPct: number; socGkg: number; ph: number; awcMmPerM: number }
  climate: { years: string; rainMedianMm: number; rainDryYearsMm: number; et0AnnualMm: number; dryYears: number; frostYears: number; nYears: number }
  data: { weatherSource: string; rotationsReplayed: number; notes: string[] }
}

export interface SavedStrategy {
  id: string
  profile_id: string
  title: string
  plan_key: string
  field_name: string | null
  lat: number
  lon: number
  payload: SavedStrategyPayload
  created_at: string
}

export interface Memory {
  id: string
  profile_id: string
  fact: string
  source: 'helper' | 'farmer'
  created_at: string
}

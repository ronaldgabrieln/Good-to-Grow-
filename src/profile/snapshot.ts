// Build the saved-strategy snapshot from what is on the results screen.
import type { PlanKey } from '../agent/toolDefs'
import { rotationLabel, type EngineInput, type EngineResult, type RotationMetrics, type Slots, type StrategyCard } from '../engine'
import { PLAIN_TITLE } from '../tool/plans'
import type { SavedStrategyPayload } from './types'

export interface PlanSnapshotInput {
  input: EngineInput
  result: EngineResult
  plan: {
    key: PlanKey
    slots: Slots
    metrics: RotationMetrics
    problems: string[]
    card: StrategyCard | null
    fromKey?: Exclude<PlanKey, 'yours'>
    edits?: string[]
  }
}

export function buildPayload({ input, result, plan }: PlanSnapshotInput): SavedStrategyPayload {
  const f = result.features
  const s = result.soil
  const base = result.strategies.find((x) => x.type === 'current')?.metrics ?? null
  const card = plan.card
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    field: input.field,
    current: input.current,
    priorities: input.priorities,
    scenario: input.scenario,
    plan: {
      key: plan.key,
      title: PLAIN_TITLE[plan.key],
      slots: plan.slots,
      label: rotationLabel(plan.slots),
      fromKey: plan.fromKey,
      fromTitle: plan.fromKey ? PLAIN_TITLE[plan.fromKey] : undefined,
      edits: plan.edits,
      metrics: plan.metrics,
      baseMetrics: plan.key === 'current' ? null : base,
      card: card ? { headline: card.headline, why: card.why, benefits: card.benefits, tradeoffs: card.tradeoffs, risks: card.risks, gaps: card.gaps, extension: card.extension } : null,
      problems: plan.problems,
    },
    soil: { source: s.source, texture: s.textureClass, sandPct: s.sandPct, clayPct: s.clayPct, socGkg: s.socGkg, ph: s.ph, awcMmPerM: s.awcMmPerM },
    climate: {
      years: `${f.firstYear}–${f.lastYear}`,
      rainMedianMm: f.rainMedianMm,
      rainDryYearsMm: f.rainP10Mm,
      et0AnnualMm: f.et0AnnualMm,
      dryYears: f.dryYears,
      frostYears: f.frostYears,
      nYears: f.nYears,
    },
    data: { weatherSource: result.weather.source, rotationsReplayed: result.poolSize, notes: input.data.notes },
  }
}

/** Default title: "Best for you · Maneadero valley · 14 Nov 2026". */
export function defaultTitle(p: SavedStrategyPayload): string {
  const d = new Date(p.savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${p.plan.title} · ${p.field.name} · ${d}`.slice(0, 120)
}

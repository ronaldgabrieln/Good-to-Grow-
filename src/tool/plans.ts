// Plain names and plain stats for the plans on the results screen, shared by the choice card and
// the agent's change proposals.

import type { RotationMetrics } from '../engine'
import type { PlanKey } from '../agent/toolDefs'
import { fmt } from './format'

/** Plain names a farmer understands. "yours" is the plan the farmer edited with the helper. */
export const PLAIN_TITLE: Record<PlanKey, string> = {
  current: 'What you do now',
  'small-change': 'A small change',
  best: 'Best for you',
  different: 'Another way',
  yours: 'Your plan',
}

export interface Stat {
  label: string
  text: string
  tone: 'good' | 'bad' | 'same'
}

const pct = (a: number, b: number) => (b === 0 ? 0 : ((a - b) / Math.abs(b)) * 100)

/** Water / money / soil in plain words, compared with `base` (usually the current rotation). */
export function plainStats(m: RotationMetrics, base: RotationMetrics | null): Stat[] {
  if (!base) {
    return [
      { label: 'Water', text: `${fmt(m.waterMm * 10)} m³ per hectare a year`, tone: 'same' },
      { label: 'Money', text: `Income score ${fmt(m.income, 1)}`, tone: 'same' },
      { label: 'Soil', text: `${fmt(m.erosionT, 1)} t/ha of soil lost a year`, tone: 'same' },
    ]
  }
  const w = pct(m.waterMm, base.waterMm)
  const inc = pct(m.income, base.income)
  const ero = pct(m.erosionT, base.erosionT)
  const carb = pct(m.soilCarbon, base.soilCarbon)
  const soilGood = (ero <= -5 ? 1 : ero >= 5 ? -1 : 0) + (carb >= 5 ? 1 : carb <= -5 ? -1 : 0)
  return [
    {
      label: 'Water',
      text: Math.abs(w) < 3 ? 'About the same water' : `Uses ${fmt(Math.abs(w))}% ${w < 0 ? 'less' : 'more'} water`,
      tone: Math.abs(w) < 3 ? 'same' : w < 0 ? 'good' : 'bad',
    },
    {
      label: 'Money',
      text: Math.abs(inc) < 3 ? 'About the same income' : `Earns about ${fmt(Math.abs(inc))}% ${inc > 0 ? 'more' : 'less'}`,
      tone: Math.abs(inc) < 3 ? 'same' : inc > 0 ? 'good' : 'bad',
    },
    {
      label: 'Soil',
      text: soilGood > 0 ? 'Protects the soil better' : soilGood < 0 ? 'Harder on the soil' : 'About the same for the soil',
      tone: soilGood > 0 ? 'good' : soilGood < 0 ? 'bad' : 'same',
    },
  ]
}

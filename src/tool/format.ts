import type { Provenance, StrategyType } from '../engine'

export const fmt = (v: number, d = 0) =>
  Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '–'

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const TYPE_LABEL: Record<StrategyType, string> = {
  current: 'Your current rotation',
  'small-change': 'Small change',
  best: 'Best match for your priorities',
  different: 'A different approach',
}

export const PROVENANCE_HINT: Record<Provenance, string> = {
  observed: 'Measured or observed (satellite / reanalysis data)',
  modeled: 'Calculated by a model from observed data',
  assumed: 'Assumption or literature value — verify locally',
}

import { candidatesForSlot, canonicalKey, checkRotation, evaluateRotation, SLOT_COUNT, type Evaluation } from './rotation'
import type { SimContext } from './simulate'
import type { CriterionScores, Priorities, PriorityKey, RotationMetrics, Slots } from './types'

export const PRIORITY_KEYS: PriorityKey[] = ['water', 'income', 'soil', 'nitrogen', 'erosion', 'pest', 'risk']

export const PRIORITY_LABELS: Record<PriorityKey, string> = {
  water: 'Save irrigation water',
  income: 'Income',
  soil: 'Build soil organic matter',
  nitrogen: 'Less nitrogen fertilizer',
  erosion: 'Less erosion',
  pest: 'Break pest & disease cycles',
  risk: 'Lower weather risk',
}

/** Raw criterion value where higher = better. */
export function criterionValue(m: RotationMetrics, k: PriorityKey): number {
  switch (k) {
    case 'water':
      return -m.waterMm
    case 'income':
      return m.income
    case 'soil':
      return m.soilCarbon
    case 'nitrogen':
      return -m.nitrogenKg
    case 'erosion':
      return -m.erosionT
    case 'pest':
      return m.pestScore
    case 'risk':
      return -(0.7 * m.failureRisk + 0.3 * (m.income > 0 ? 1 - m.incomeLowYear / m.income : 0))
  }
}

export function weightsOf(p: Priorities): Priorities {
  const sum = PRIORITY_KEYS.reduce((s, k) => s + Math.max(0, p[k]), 0) || 1
  return Object.fromEntries(PRIORITY_KEYS.map((k) => [k, Math.max(0, p[k]) / sum])) as Priorities
}

/** Min–max normalize each criterion across a pool to 0–100, then weighted sum. */
export function scorePool(metrics: RotationMetrics[], priorities: Priorities): { scores: CriterionScores[]; totals: number[] } {
  const w = weightsOf(priorities)
  const ranges = PRIORITY_KEYS.map((k) => {
    const vals = metrics.map((m) => criterionValue(m, k))
    return [Math.min(...vals), Math.max(...vals)] as const
  })
  const scores = metrics.map((m) => {
    const s = {} as CriterionScores
    PRIORITY_KEYS.forEach((k, i) => {
      const [lo, hi] = ranges[i]
      s[k] = hi - lo < 1e-9 ? 50 : (100 * (criterionValue(m, k) - lo)) / (hi - lo)
    })
    return s
  })
  const totals = scores.map((s) => PRIORITY_KEYS.reduce((sum, k) => sum + w[k] * s[k], 0))
  return { scores, totals }
}

interface BeamItem {
  slots: Slots
  ev: Evaluation
}

export interface GenerateOptions {
  beamWidth?: number
  specialistsPerCriterion?: number
}

/**
 * Generate candidate rotations with a beam search over the 6 season slots.
 * Each partial rotation is replayed (non-cyclic) against the full weather history and scored
 * relative to the other partials at the same depth, so pruning uses the farmer's own priorities.
 * A few "specialists" per criterion are kept so strong single-goal options survive.
 */
export function generateCandidates(
  ctx: SimContext,
  priorities: Priorities,
  opts: GenerateOptions = {},
): { slots: Slots; ev: Evaluation }[] {
  const beamWidth = opts.beamWidth ?? 120
  const specialists = opts.specialistsPerCriterion ?? 6
  let beam: { slots: Slots; ev: Evaluation | null }[] = [{ slots: [], ev: null }]

  for (let depth = 0; depth < SLOT_COUNT; depth++) {
    const options = candidatesForSlot(depth)
    const next: BeamItem[] = []
    const seen = new Set<string>()
    const final = depth === SLOT_COUNT - 1
    for (const item of beam) {
      for (const opt of options) {
        const slots = [...item.slots, opt]
        const key = final ? canonicalKey(slots) : slots.join(',')
        if (seen.has(key)) continue
        seen.add(key)
        if (!checkRotation(slots, final).ok) continue
        // Partial rotations ending in empty slots are only worth keeping if something is planted.
        const ev = evaluateRotation(ctx, slots, final)
        if (!ev) {
          if (slots.some(Boolean)) continue
          next.push({ slots, ev: { metrics: emptyMetrics(), events: [], windows: [] } })
          continue
        }
        next.push({ slots, ev })
      }
    }
    if (next.length === 0) return []
    const { scores, totals } = scorePool(
      next.map((x) => x.ev.metrics),
      priorities,
    )
    const order = totals.map((t, i) => [t, i] as const).sort((a, b) => b[0] - a[0])
    const keep = new Set<number>(order.slice(0, beamWidth).map(([, i]) => i))
    for (const k of PRIORITY_KEYS) {
      const byK = scores.map((s, i) => [s[k], totals[i], i] as const).sort((a, b) => b[0] - a[0] || b[1] - a[1])
      for (const [, , i] of byK.slice(0, specialists)) keep.add(i)
    }
    beam = [...keep].map((i) => next[i])
  }
  return beam.filter((b): b is BeamItem => b.ev !== null && b.ev.windows.length > 0)
}

function emptyMetrics(): RotationMetrics {
  return {
    waterMm: 0,
    waterDryYearMm: 0,
    income: 0,
    incomeLowYear: 0,
    soilCarbon: 0,
    residueT: 0,
    nitrogenKg: 0,
    erosionT: 0,
    bareRainyDays: 0,
    bareDays: 0,
    pestScore: 85,
    pestNotes: [],
    failureRisk: 0,
    cyclesReplayed: 0,
  }
}

export function hamming(a: Slots, b: Slots): number {
  let d = 0
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? null) !== (b[i] ?? null)) d++
  return d
}

/** Minimum Hamming distance across the rotation's year shifts (so shifted copies count as identical). */
export function rotationDistance(a: Slots, b: Slots): number {
  const years = a.length / 2
  let best = Infinity
  for (let s = 0; s < years; s++) {
    const shifted = [...b.slice(s * 2), ...b.slice(0, s * 2)]
    best = Math.min(best, hamming(a, shifted))
  }
  return best
}

/**
 * All valid rotations within `maxChanges` slot edits of the current one.
 * These are the "small change" options: easiest for a farmer to adopt.
 */
export function neighborhood(ctx: SimContext, current: Slots, maxChanges = 2): { slots: Slots; ev: Evaluation }[] {
  const out: { slots: Slots; ev: Evaluation }[] = []
  const options = current.map((_, i) => candidatesForSlot(i))
  const seen = new Set<string>()
  const tryAdd = (slots: Slots) => {
    const key = slots.join(',')
    if (seen.has(key)) return
    seen.add(key)
    if (!checkRotation(slots, true).ok) return
    const ev = evaluateRotation(ctx, slots, true)
    if (ev) out.push({ slots, ev })
  }
  for (let i = 0; i < current.length; i++) {
    for (const a of options[i]) {
      if (a === current[i]) continue
      const s1 = [...current]
      s1[i] = a
      tryAdd(s1)
      if (maxChanges < 2) continue
      for (let j = i + 1; j < current.length; j++) {
        for (const b of options[j]) {
          if (b === current[j]) continue
          const s2 = [...s1]
          s2[j] = b
          tryAdd(s2)
        }
      }
    }
  }
  return out
}

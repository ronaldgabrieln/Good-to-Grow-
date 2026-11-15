// Runs the planning agent's tools against the engine. Everything here is deterministic code: the
// model only chooses which tool to call and explains the result. Figures are rounded here (to the
// precision a farmer would quote) and comparisons are precomputed, so the model never does math.

import { z } from 'zod'
import {
  CROP_BY_ID,
  RULES,
  SOURCES,
  cropDuration,
  type EngineInput,
  type EngineResult,
  type RotationMetrics,
  type Scenario,
  type SlotEvaluation,
  type Slots,
  type Strategy,
} from '../engine'
import { doyToLabel } from '../engine/features'
import type { SavedStrategy } from '../profile/types'
import { CROP_IDS, LAYERS, PLAN_KEYS, SLOT_VALUES, type OptionKey, type PlanKey } from './toolDefs'

/** The farmer's own plan, made by allowing a change the helper proposed. */
export interface YourPlan {
  /** The engine option it started from. */
  from: OptionKey
  slots: Slots
}

/** A change the helper wants to make; the farmer allows or denies it in the chat. */
export interface Proposal {
  id: string
  base: PlanKey
  baseTitle: string
  before: Slots
  after: Slots
  changes: { season: string; from: string; to: string }[]
  reason: string
  problems: string[]
  metrics: RotationMetrics | null
  baseMetrics: RotationMetrics | null
}

export interface AgentContext {
  result: EngineResult
  input: EngineInput
  evaluate: (input: EngineInput, items: { slots: Slots; scenario?: Scenario }[]) => Promise<SlotEvaluation[]>
  /** Select a plan and layer on the 3D view; returns an error message or null. */
  showOnLand: (option: PlanKey, layer: (typeof LAYERS)[number]) => string | null
  /** The plan the farmer has open on screen. */
  viewing: PlanKey
  yours: YourPlan | null
  /** Make the rotation the farmer's plan ("yours") and show it. Only called after the farmer allows it. */
  applyPlan: (plan: YourPlan) => void
  /** Shows a proposal in the chat and resolves with the farmer's decision (set by the agent loop). */
  requestApproval?: (p: Proposal) => Promise<boolean>
  /** The signed-in farmer's profile (Supabase), or null/absent when nobody is signed in. */
  farmer?: FarmerMemory | null
  /** Save a fact to the farmer's memory. Only called after the farmer allows it. */
  remember?: (fact: string) => Promise<void>
  /** Shows a memory proposal in the chat and resolves with the farmer's decision (set by the agent loop). */
  requestMemoryApproval?: (m: MemoryProposal) => Promise<boolean>
}

export interface FarmerMemory {
  username: string
  memories: { fact: string; created_at: string }[]
  strategies: SavedStrategy[]
}

/** A fact the helper wants to remember; the farmer allows or denies it in the chat. */
export interface MemoryProposal {
  id: string
  fact: string
}

export interface ToolOutput {
  /** JSON string sent back to the model. */
  content: string
  isError: boolean
  /** Plain-language step shown in the chat ("Tested your idea…"). */
  summary: string
  /** Data sources behind this result, shown under the answer. */
  sources: string[]
}

// ───────── input validation (the API enforces the same schemas with strict: true; this is defense in depth)

const Slot = z.enum(SLOT_VALUES as [string, ...string[]])
const Option = z.enum([...PLAN_KEYS, 'custom'])
const Target = z.object({ option: Option, slots: z.array(Slot) }).strict()
const SCHEMAS = {
  get_field_overview: z.object({}).strict(),
  get_options: z.object({}).strict(),
  evaluate_rotation: z.object({ slots: z.array(Slot) }).strict(),
  compare_rotations: z.object({ a: Target, b: Target }).strict(),
  test_climate: z.object({ target: Target, warmer_c: z.number(), rain_change_pct: z.number() }).strict(),
  crop_info: z.object({ crop: z.enum(CROP_IDS as [string, ...string[]]) }).strict(),
  season_plan: z.object({ target: Target }).strict(),
  show_on_land: z.object({ option: z.enum(PLAN_KEYS), layer: z.enum(LAYERS) }).strict(),
  propose_change: z.object({ base: z.enum(PLAN_KEYS), slots: z.array(Slot), reason: z.string().max(400) }).strict(),
  recall_farmer: z.object({}).strict(),
  propose_memory: z.object({ fact: z.string().trim().min(3).max(200) }).strict(),
}
type ToolName = keyof typeof SCHEMAS

class ToolInputError extends Error {}

// ───────── formatting helpers

const r = (v: number, d = 0) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null)
const pctChange = (a: number, b: number) => (b === 0 ? null : r(((a - b) / Math.abs(b)) * 100))
const SEASON_NAMES = ['Year 1 spring', 'Year 1 fall', 'Year 2 spring', 'Year 2 fall', 'Year 3 spring', 'Year 3 fall']
const OPTION_TITLE: Record<PlanKey, string> = {
  current: 'What you do now (current rotation)',
  'small-change': 'A small change',
  best: 'Best for you',
  different: 'Another way',
  yours: 'Your plan (edited with the helper)',
}
const cropName = (id: string) => CROP_BY_ID[id].name.replace(/ \(.*\)$/, '')

function seasons(slots: Slots) {
  return slots.map((id, i) => ({ season: SEASON_NAMES[i], crop: id ?? 'none', name: id ? cropName(id) : 'nothing planted' }))
}

function figures(m: RotationMetrics) {
  return {
    irrigation_mm_per_year: r(m.waterMm),
    irrigation_m3_per_hectare_per_year: r(m.waterMm * 10),
    irrigation_in_driest_10pct_of_cycles_mm_per_year: r(m.waterDryYearMm),
    income_index_per_year: r(m.income, 1),
    income_index_in_worst_10pct_of_cycles: r(m.incomeLowYear, 1),
    crop_residue_returned_t_per_hectare_per_year: r(m.residueT, 1),
    nitrogen_fertilizer_to_buy_kg_per_hectare_per_year: r(m.nitrogenKg),
    soil_loss_t_per_hectare_per_year: r(m.erosionT, 2),
    bare_days_in_rainy_season_per_year: r(m.bareRainyDays),
    pest_and_disease_break_score_out_of_100: r(m.pestScore),
    pest_notes: m.pestNotes,
    cycles_with_a_failed_crop_pct: r(m.failureRisk * 100),
    start_years_replayed: m.cyclesReplayed,
  }
}

/** Precomputed changes of `m` versus `base`, so the model never calculates them. */
function changes(m: RotationMetrics, base: RotationMetrics) {
  return {
    irrigation_change_pct: pctChange(m.waterMm, base.waterMm),
    irrigation_change_m3_per_hectare_per_year: r((m.waterMm - base.waterMm) * 10),
    income_index_change_pct: pctChange(m.income, base.income),
    soil_carbon_input_change_pct: pctChange(m.soilCarbon, base.soilCarbon),
    nitrogen_fertilizer_change_kg_per_hectare_per_year: r(m.nitrogenKg - base.nitrogenKg),
    nitrogen_fertilizer_change_pct: pctChange(m.nitrogenKg, base.nitrogenKg),
    soil_loss_change_pct: pctChange(m.erosionT, base.erosionT),
    bare_rainy_season_days_change: r(m.bareRainyDays - base.bareRainyDays),
    pest_break_score_change: r(m.pestScore - base.pestScore),
    failed_crop_cycles_change_percentage_points: r((m.failureRisk - base.failureRisk) * 100),
    meaning: 'Negative irrigation, nitrogen and soil-loss changes are improvements; positive income, soil-carbon and pest-score changes are improvements.',
  }
}

function cropEvents(ev: Pick<SlotEvaluation, 'events'>) {
  return ev.events.map((e) => ({
    crop: e.cropId,
    name: cropName(e.cropId),
    season: SEASON_NAMES[e.slot],
    years_replayed: e.yearsReplayed,
    years_with_damaging_frost: e.frostYears,
    years_with_heat_stress: e.heatYears,
    years_with_yield_below_60pct: e.failedYears,
    average_modeled_yield_pct: r(e.meanYieldFactor * 100),
    yield_with_your_well_salinity_pct: r(e.salinityFactor * 100),
    extra_water_to_flush_salt_pct: r(e.leachingFraction * 100),
    irrigation_mm: r(e.meanIrrigationMm),
  }))
}

const INCOME_NOTE = 'income_index is a relative index from the engine (placeholder values per crop), not money or market prices.'

// ───────── resolving rotations

function strategyFor(ctx: AgentContext, option: OptionKey): Strategy {
  const s = ctx.result.strategies.find((x) => x.type === option)
  if (!s) throw new ToolInputError(`The option "${option}" is not on screen right now. Available: ${ctx.result.strategies.map((x) => x.type).join(', ')}.`)
  return s
}

function toSlots(raw: string[]): Slots {
  if (raw.length !== 6) throw new ToolInputError(`A rotation needs exactly 6 seasons, got ${raw.length}.`)
  return raw.map((x) => (x === 'none' ? null : x))
}

function planSlots(ctx: AgentContext, key: PlanKey): Slots {
  if (key === 'yours') {
    if (!ctx.yours) throw new ToolInputError('The farmer has no edited plan ("yours") yet. Use one of the options, or propose_change to make one.')
    return ctx.yours.slots
  }
  return strategyFor(ctx, key).rotation.slots
}

function resolveTarget(ctx: AgentContext, t: z.infer<typeof Target>): { slots: Slots; title: string } {
  if (t.option === 'custom') return { slots: toSlots(t.slots), title: 'your idea' }
  return { slots: planSlots(ctx, t.option), title: OPTION_TITLE[t.option] }
}

const slotName = (id: string | null) => (id ? cropName(id) : 'nothing planted')
const sameSlots = (a: Slots, b: Slots) => a.length === b.length && a.every((x, i) => x === b[i])

function evaluationOut(ev: SlotEvaluation) {
  return {
    rotation: ev.label || 'nothing planted',
    seasons: seasons(ev.slots),
    rule_problems: ev.validity.reasons,
    figures: ev.metrics ? figures(ev.metrics) : null,
    change_versus_current_rotation: ev.metrics && ev.currentMetrics ? changes(ev.metrics, ev.currentMetrics) : null,
    crop_events: cropEvents(ev),
    risks: ev.card?.risks ?? [],
    information_gaps: ev.card?.gaps ?? [],
    evidence: (ev.card?.evidence ?? []).map((e) => ({ text: e.text, source: e.source, kind: e.provenance })),
  }
}

const evidenceSources = (ev: { card: { evidence: { source: string }[] } | null }) => (ev.card?.evidence ?? []).map((e) => e.source)

// ───────── the tools

async function getFieldOverview(ctx: AgentContext) {
  const { result, input } = ctx
  const f = result.features
  const s = result.soil
  const field = input.field
  const gaps = result.strategies[0]?.card.gaps ?? []
  return {
    out: {
      field: {
        name: field.name,
        latitude: r(field.lat, 3),
        longitude: r(field.lon, 3),
        elevation_m: r(field.elevationM),
        slope_pct: r(field.slopePct, 1),
        well_water_salinity_ds_per_m: r(field.wellEcDsM, 1),
        irrigation_efficiency_pct: r(field.irrigationEfficiency * 100),
      },
      soil: {
        source: s.source === 'soilgrids' ? 'SoilGrids (modeled, 250 m)' : 'default valley soil (SoilGrids was unavailable)',
        texture: s.textureClass,
        sand_pct: r(s.sandPct),
        clay_pct: r(s.clayPct),
        organic_carbon_g_per_kg: r(s.socGkg, 1),
        ph: r(s.ph, 1),
        water_held_mm_per_m_of_soil: r(s.awcMmPerM),
      },
      climate: {
        years: `${f.firstYear}-${f.lastYear}`,
        rain_per_year_median_mm: r(f.rainMedianMm),
        rain_dry_years_mm: r(f.rainP10Mm),
        rain_wet_years_mm: r(f.rainP90Mm),
        share_of_rain_in_nov_to_mar_pct: r(f.rainySeasonShare * 100),
        crop_water_demand_per_year_mm: r(f.et0AnnualMm),
        rain_covers_pct_of_water_demand: r(f.aridityIndex * 100),
        very_dry_years: `${f.dryYears} of ${f.hydroYears.length}`,
        years_with_frost: `${f.frostYears} of ${f.nYears}`,
        hot_days_over_35c_per_year_median: r(f.heatDaysMedian),
        years_with_under_25mm_rain_in_nov_dec: `${f.poorFallRainYears} of ${f.nYears}`,
        by_month: f.monthly.map((m) => ({
          month: m.month,
          rain_mm: r(m.rainMeanMm),
          crop_water_demand_mm: r(m.et0MeanMm),
          average_high_c: r(m.tmaxMean, 1),
          average_low_c: r(m.tminMean, 1),
          chance_of_frost_pct: r(m.frostProb * 100),
        })),
      },
      data_handling: {
        weather_grid_cells_averaged: result.weather.cells.length,
        rain_spells_removed_as_implausible: result.weather.rainFlags.map((x) => ({ from: x.start, to: x.end, total_mm: r(x.totalMm) })),
      },
      information_gaps: gaps,
      agronomic_rules: RULES,
    },
    summary: "Read your field's data",
    sources: [SOURCES.power, SOURCES.soilgrids],
  }
}

async function getOptions(ctx: AgentContext) {
  const base = ctx.result.strategies.find((s) => s.type === 'current')?.metrics ?? null
  const [mine] = ctx.yours ? await ctx.evaluate(ctx.input, [{ slots: ctx.yours.slots }]) : [null]
  return {
    out: {
      note: INCOME_NOTE,
      farmer_is_looking_at: { option: ctx.viewing, title: OPTION_TITLE[ctx.viewing] },
      your_plan: mine && ctx.yours ? { option: 'yours', title: OPTION_TITLE.yours, started_from: ctx.yours.from, ...evaluationOut(mine) } : null,
      options: ctx.result.strategies.map((s) => ({
        option: s.type,
        title: OPTION_TITLE[s.type],
        rotation: s.rotation.label,
        seasons: seasons(s.rotation.slots),
        rank_among_generated_rotations: s.rank || null,
        fit_to_priorities_out_of_100: r(s.total),
        figures: figures(s.metrics),
        change_versus_current_rotation: base && s.type !== 'current' ? changes(s.metrics, base) : null,
        why: s.card.why,
        benefits: s.card.benefits,
        tradeoffs: s.card.tradeoffs,
        risks: s.card.risks,
        crop_events: cropEvents(s),
        evidence: s.card.evidence.map((e) => ({ text: e.text, source: e.source, kind: e.provenance })),
        talk_to_your_agronomist_about: s.card.extension,
      })),
    },
    summary: `Looked at your plans (on screen: ${OPTION_TITLE[ctx.viewing].toLowerCase()})`,
    sources: [...new Set(ctx.result.strategies.flatMap((s) => s.card.evidence.map((e) => e.source)))],
  }
}

async function evaluateRotationTool(ctx: AgentContext, slotsRaw: string[]) {
  const slots = toSlots(slotsRaw)
  const [ev] = await ctx.evaluate(ctx.input, [{ slots }])
  return {
    out: { note: INCOME_NOTE, ...evaluationOut(ev) },
    summary: `Tested your idea: ${ev.label || 'nothing planted'}`,
    sources: evidenceSources(ev),
  }
}

async function compareRotations(ctx: AgentContext, a: z.infer<typeof Target>, b: z.infer<typeof Target>) {
  const ta = resolveTarget(ctx, a)
  const tb = resolveTarget(ctx, b)
  const [ea, eb] = await ctx.evaluate(ctx.input, [{ slots: ta.slots }, { slots: tb.slots }])
  return {
    out: {
      note: INCOME_NOTE,
      a: { title: ta.title, ...evaluationOut(ea) },
      b: { title: tb.title, ...evaluationOut(eb) },
      b_versus_a: ea.metrics && eb.metrics ? changes(eb.metrics, ea.metrics) : null,
    },
    summary: `Compared ${ta.title} with ${tb.title}`,
    sources: [...new Set([...evidenceSources(ea), ...evidenceSources(eb)])],
  }
}

async function testClimate(ctx: AgentContext, target: z.infer<typeof Target>, warmer: number, rainPct: number) {
  if (warmer < 0 || warmer > 3) throw new ToolInputError('warmer_c must be between 0 and 3.')
  if (rainPct < -30 || rainPct > 10) throw new ToolInputError('rain_change_pct must be between -30 and 10.')
  const t = resolveTarget(ctx, target)
  const scenario: Scenario = { deltaTempC: warmer, rainChange: rainPct / 100 }
  const [observed, changed] = await ctx.evaluate(ctx.input, [
    { slots: t.slots, scenario: { deltaTempC: 0, rainChange: 0 } },
    { slots: t.slots, scenario },
  ])
  return {
    out: {
      rotation: t.title,
      scenario: { warmer_c: warmer, rain_change_pct: rainPct, meaning: 'Every one of the 30 years shifted by this much, then replayed again.' },
      observed_climate_figures: observed.metrics ? figures(observed.metrics) : null,
      scenario_figures: changed.metrics ? figures(changed.metrics) : null,
      scenario_versus_observed: observed.metrics && changed.metrics ? changes(changed.metrics, observed.metrics) : null,
      crop_events_under_scenario: cropEvents(changed),
    },
    summary: `Tested ${t.title} with ${[warmer > 0 ? `+${warmer} °C` : '', rainPct !== 0 ? `${rainPct > 0 ? '+' : ''}${rainPct}% rain` : ''].filter(Boolean).join(' and ') || 'the same climate'}`,
    sources: [SOURCES.power, SOURCES.fao56],
  }
}

async function cropInfo(id: string) {
  const c = CROP_BY_ID[id]
  return {
    out: {
      crop: c.id,
      name: c.name,
      name_es: c.nameEs,
      kind: c.kind,
      family: c.family,
      planting_dates_here: {
        spring_summer: c.plant.A !== undefined ? doyToLabel(c.plant.A) : null,
        fall_winter: c.plant.B !== undefined ? doyToLabel(c.plant.B) : null,
      },
      days_in_the_field: cropDuration(c),
      peak_water_use_coefficient_kc: c.kc[1],
      root_depth_m: c.rootDepthM,
      salt_tolerance: {
        no_loss_up_to_soil_salinity_ds_per_m: c.salinity.threshold,
        yield_loss_pct_per_extra_ds_per_m: c.salinity.slope,
        estimated: c.salinity.estimated ?? false,
      },
      damaged_by_frost_at_c: c.frostKillC,
      heat_stress_from_c: c.heatStressC,
      best_average_temperature_c: { from: c.tOpt[0], to: c.tOpt[1] },
      nitrogen_fertilizer_kg_per_hectare: c.nDemandKg,
      nitrogen_left_for_next_crop_kg_per_hectare: c.nCreditKg,
      residue_returned_t_per_hectare: c.residueT,
      income_index_per_planting: c.marketIndex,
      irrigation: c.irrigation === 'full' ? 'irrigated all season' : 'mostly rain-fed, one establishment irrigation',
      years_before_same_family_should_return: c.returnYears,
      biofumigant: c.biofumigant ?? false,
      notes: c.notes ?? null,
      note: INCOME_NOTE,
    },
    summary: `Read about ${cropName(id)}`,
    sources: [SOURCES.fao56, c.salinity.estimated ? 'Salinity values estimated by analogy' : SOURCES.fao29, SOURCES.ecocrop, ...(c.kind === 'cover' ? [SOURCES.sare] : []), SOURCES.market],
  }
}

function dayLabel(day: number) {
  const year = (Math.floor(day / 365) % 3) + 1
  return `Year ${year}, ${doyToLabel((day % 365) + 1)}`
}

function rainySeasonIn(from: number, to: number) {
  for (let d = from; d < to; d += 7) {
    const month = new Date(Date.UTC(2001, 0, (d % 365) + 1)).getUTCMonth() + 1
    if (month >= 11 || month <= 3) return true
  }
  return false
}

async function seasonPlan(ctx: AgentContext, target: z.infer<typeof Target>) {
  const t = resolveTarget(ctx, target)
  const [ev] = await ctx.evaluate(ctx.input, [{ slots: t.slots }])
  const wins = [...ev.windows].sort((a, b) => a.startDay - b.startDay)
  const tasks: { when: string; task: string }[] = []
  wins.forEach((w, k) => {
    const c = CROP_BY_ID[w.cropId]
    const e = ev.events.find((x) => x.slot === w.slot)
    if (c.kind === 'cover') {
      tasks.push({ when: dayLabel(w.startDay), task: `Sow ${cropName(c.id)} (cover crop). If the soil is dry, give one establishment irrigation of about 25 mm.` })
      tasks.push({ when: dayLabel(w.endDay), task: `End the ${cropName(c.id)} (cut or incorporate it) before the next crop goes in.` })
    } else {
      tasks.push({
        when: dayLabel(w.startDay),
        task: `Plant ${cropName(c.id)}.${e ? ` Modeled irrigation for this crop: about ${r(e.meanIrrigationMm)} mm.` : ''}`,
      })
      tasks.push({ when: dayLabel(w.endDay), task: `${cropName(c.id)} harvest finishes around here.` })
    }
    const next = wins[k + 1]
    const nextStart = next ? next.startDay : wins[0].startDay + 3 * 365
    if (nextStart - w.endDay > 14) {
      tasks.push({
        when: `${dayLabel(w.endDay)} to ${dayLabel(nextStart)}`,
        task: `Field bare for ${nextStart - w.endDay} days${rainySeasonIn(w.endDay, nextStart) ? ' during rainy-season months (Nov-Mar): soil can wash away; a cover crop or crop residue protects it' : ''}.`,
      })
    }
  })
  return {
    out: {
      rotation: t.title,
      seasons: seasons(t.slots),
      rule_problems: ev.validity.reasons,
      tasks,
      note: 'Dates are typical planting windows used by the engine for this valley; adjust to the actual weather and your agronomist.',
    },
    summary: `Made a season plan for ${t.title}`,
    sources: [SOURCES.fao56, 'GoodToGrow planting windows'],
  }
}

async function proposeChange(ctx: AgentContext, baseKey: PlanKey, slotsRaw: string[], reason: string) {
  if (!ctx.requestApproval) throw new ToolInputError('Changes cannot be proposed right now.')
  const before = planSlots(ctx, baseKey)
  const after = toSlots(slotsRaw)
  if (sameSlots(before, after)) throw new ToolInputError('This rotation is the same as the plan; nothing would change.')
  const [ev, baseEv] = await ctx.evaluate(ctx.input, [{ slots: after }, { slots: before }])
  const changed = after.flatMap((id, i) => (id === before[i] ? [] : [{ season: SEASON_NAMES[i], from: slotName(before[i]), to: slotName(id) }]))
  const proposal: Proposal = {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    base: baseKey,
    baseTitle: OPTION_TITLE[baseKey],
    before,
    after,
    changes: changed,
    reason: reason.trim(),
    problems: ev.validity.reasons,
    metrics: ev.metrics,
    baseMetrics: baseEv.metrics,
  }
  const yoursBefore = ctx.yours
  const allowed = await ctx.requestApproval(proposal)
  if (!allowed) {
    return {
      out: { decision: 'denied', plan: baseKey, note: 'The farmer said no. Nothing changed. Ask what they would prefer instead; do not propose the same change again.' },
      summary: `Proposed a change to ${OPTION_TITLE[baseKey].toLowerCase()}: you said no`,
      sources: [],
    }
  }
  ctx.applyPlan({ from: baseKey === 'yours' && yoursBefore ? yoursBefore.from : (baseKey as OptionKey), slots: after })
  return {
    out: {
      decision: 'allowed',
      now_on_screen: 'yours',
      changed_seasons: changed,
      ...evaluationOut(ev),
      change_versus_plan_before_the_change: ev.metrics && baseEv.metrics ? changes(ev.metrics, baseEv.metrics) : null,
      note: INCOME_NOTE,
    },
    summary: `Changed ${OPTION_TITLE[baseKey].toLowerCase()}: you allowed it`,
    sources: evidenceSources(ev),
  }
}

const savedOn = (iso: string) => iso.slice(0, 10)

async function recallFarmer(ctx: AgentContext) {
  const f = ctx.farmer
  if (!f) {
    return {
      out: { signed_in: false, note: 'Nobody is signed in, so nothing is remembered and no plans are saved. The farmer can sign in with a username at the top of the screen to save plans and let you remember facts.' },
      summary: 'Checked your profile: not signed in',
      sources: [],
    }
  }
  return {
    out: {
      signed_in: true,
      username: f.username,
      remembered_facts: f.memories.map((m) => ({ fact: m.fact, saved_on: savedOn(m.created_at) })),
      saved_plans: f.strategies.slice(0, 10).map((s) => {
        const p = s.payload
        return {
          title: s.title,
          saved_on: savedOn(s.created_at),
          place: s.field_name,
          latitude: r(s.lat, 3),
          longitude: r(s.lon, 3),
          plan: p.plan.title,
          rotation: p.plan.label,
          seasons: seasons(p.plan.slots),
          figures_when_saved: figures(p.plan.metrics),
          change_versus_current_rotation_when_saved: p.plan.baseMetrics ? changes(p.plan.metrics, p.plan.baseMetrics) : null,
          climate_test_when_saved: p.scenario.deltaTempC || p.scenario.rainChange ? { warmer_c: p.scenario.deltaTempC, rain_change_pct: r(p.scenario.rainChange * 100) } : null,
        }
      }),
      note:
        'Remembered facts were stated by the farmer and kept with their permission: treat them as the farmer’s own information, not as results of this analysis, and say so when you use them. Saved plans were computed when saved (same engine), possibly for another field or before data changed; use the tools for current figures. ' + INCOME_NOTE,
    },
    summary: `Checked what I remember about you (${f.memories.length} notes, ${f.strategies.length} saved plans)`,
    sources: ['Your saved profile'],
  }
}

async function proposeMemory(ctx: AgentContext, fact: string) {
  if (!ctx.farmer) throw new ToolInputError('Nobody is signed in, so nothing can be remembered. Tell the farmer they can sign in with a username at the top of the screen.')
  if (!ctx.requestMemoryApproval || !ctx.remember) throw new ToolInputError('Memory cannot be changed right now.')
  const clean = fact.trim().replace(/\s+/g, ' ')
  if (ctx.farmer.memories.some((m) => m.fact.toLowerCase() === clean.toLowerCase())) throw new ToolInputError('This is already remembered.')
  const allowed = await ctx.requestMemoryApproval({ id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, fact: clean })
  if (!allowed) {
    return {
      out: { decision: 'denied', note: 'The farmer said no. Nothing was saved. Do not ask to remember this again.' },
      summary: 'Asked to remember something: you said no',
      sources: [],
    }
  }
  await ctx.remember(clean)
  return {
    out: { decision: 'allowed', remembered: clean },
    summary: 'Remembered a note about your farm: you allowed it',
    sources: ['Your saved profile'],
  }
}

/** Run one tool call. Never throws: errors come back as an is_error result the model can read. */
export async function runTool(name: string, rawInput: unknown, ctx: AgentContext): Promise<ToolOutput> {
  try {
    if (!(name in SCHEMAS)) throw new ToolInputError(`Unknown tool "${name}".`)
    const parsed = SCHEMAS[name as ToolName].safeParse(rawInput)
    if (!parsed.success) throw new ToolInputError(`Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
    const input = parsed.data as never
    let res: { out: unknown; summary: string; sources: string[] }
    switch (name as ToolName) {
      case 'get_field_overview':
        res = await getFieldOverview(ctx)
        break
      case 'get_options':
        res = await getOptions(ctx)
        break
      case 'evaluate_rotation':
        res = await evaluateRotationTool(ctx, (input as { slots: string[] }).slots)
        break
      case 'compare_rotations': {
        const { a, b } = input as z.infer<typeof SCHEMAS.compare_rotations>
        res = await compareRotations(ctx, a, b)
        break
      }
      case 'test_climate': {
        const x = input as z.infer<typeof SCHEMAS.test_climate>
        res = await testClimate(ctx, x.target, x.warmer_c, x.rain_change_pct)
        break
      }
      case 'crop_info':
        res = await cropInfo((input as { crop: string }).crop)
        break
      case 'season_plan':
        res = await seasonPlan(ctx, (input as z.infer<typeof SCHEMAS.season_plan>).target)
        break
      case 'show_on_land': {
        const x = input as z.infer<typeof SCHEMAS.show_on_land>
        const err = ctx.showOnLand(x.option, x.layer)
        if (err) throw new ToolInputError(err)
        res = { out: { shown: true, option: x.option, layer: x.layer }, summary: `Showed ${OPTION_TITLE[x.option].toLowerCase()} on your land`, sources: ['NASA SRTM elevation'] }
        break
      }
      case 'propose_change': {
        const x = input as z.infer<typeof SCHEMAS.propose_change>
        res = await proposeChange(ctx, x.base, x.slots, x.reason)
        break
      }
      case 'recall_farmer':
        res = await recallFarmer(ctx)
        break
      case 'propose_memory':
        res = await proposeMemory(ctx, (input as z.infer<typeof SCHEMAS.propose_memory>).fact)
        break
    }
    return { content: JSON.stringify(res.out), isError: false, summary: res.summary, sources: res.sources }
  } catch (e) {
    const message = e instanceof ToolInputError ? e.message : `The engine failed: ${(e as Error).message}`
    return { content: JSON.stringify({ error: message }), isError: true, summary: `Could not run ${name.replace(/_/g, ' ')}`, sources: [] }
  }
}

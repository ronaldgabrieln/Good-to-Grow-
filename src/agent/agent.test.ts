import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CURRENT, DEFAULT_FIELD, DEFAULT_PRIORITIES, DEFAULT_SCENARIO, evaluateSlots, runEngine, type EngineInput, type FieldData } from '../engine'
import { parseSoilGrids } from '../engine/soil'
import type { PowerColumns } from '../engine/weather'
import { addToLedger, checkAnswer, parseNumber, type Ledger } from './grounding'
import { AGENT_TOOLS } from './toolDefs'
import { runTool, type AgentContext } from './toolHandlers'

const bundle = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'public', 'data', 'maneadero-demo.json'), 'utf8')) as {
  power: PowerColumns
  soilgrids: unknown
}
const data: FieldData = { power: bundle.power, soil: parseSoilGrids(bundle.soilgrids)!, source: 'demo', notes: [] }
const input: EngineInput = { data, field: DEFAULT_FIELD, scenario: DEFAULT_SCENARIO, priorities: DEFAULT_PRIORITIES, current: DEFAULT_CURRENT }
const result = runEngine(input)
const showOnLand = vi.fn(() => null)
const ctx: AgentContext = { result, input, evaluate: async (i, items) => evaluateSlots(i, items), showOnLand }
const call = async (name: string, args: unknown) => {
  const out = await runTool(name, args, ctx)
  return { ...out, json: JSON.parse(out.content) }
}

describe('number check', () => {
  it('reads English and Spanish number styles', () => {
    expect(parseNumber('1,234')).toEqual({ value: 1234, decimals: 0 })
    expect(parseNumber('1,5')).toEqual({ value: 1.5, decimals: 1 })
    expect(parseNumber('12.75')).toEqual({ value: 12.75, decimals: 2 })
  })

  it('accepts numbers at the precision quoted and flags invented ones', () => {
    const ledger: Ledger = []
    addToLedger(ledger, JSON.stringify({ irrigation_change_pct: -27.6, soil_loss_t_per_hectare_per_year: 1.33, note: 'about 1,346 m3 less' }))
    const r = checkAnswer('Uses **28%** less water (-27.6%), loses 1.3 t of soil, saves 1,346 m³ but earns 42% less.', ledger)
    expect(r.unverified).toEqual(['42'])
    expect(r.checked).toBe(5)
  })

  it('needs the same unit: a percentage cannot vouch for tonnes', () => {
    const ledger: Ledger = []
    addToLedger(ledger, JSON.stringify({ irrigation_change_pct: 42, soil_loss_t_per_hectare_per_year: 1.3, pest_score_out_of_100: 93 }))
    expect(checkAnswer('Usa 42% menos agua.', ledger).unverified).toEqual([])
    expect(checkAnswer('Pierde 42 toneladas de suelo.', ledger).unverified).toEqual(['42'])
    expect(checkAnswer('Pierde 1,3 t/ha de suelo.', ledger).unverified).toEqual([])
    expect(checkAnswer('A pest score of 93 out of 100.', ledger).unverified).toEqual([])
  })

  it('does not count small counts or years from the data', () => {
    const ledger: Ledger = [{ value: 1995, unit: null }, { value: 2024, unit: null }]
    const r = checkAnswer('Over 3 years and 2 options, from 1995 to 2024.', ledger)
    expect(r.checked).toBe(0)
  })
})

describe('tool definitions', () => {
  it('are strict: every object lists all its properties as required and allows no extras', () => {
    const walk = (s: Record<string, unknown>) => {
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false)
        expect([...(s.required as string[])].sort()).toEqual(Object.keys(s.properties as object).sort())
        Object.values(s.properties as Record<string, Record<string, unknown>>).forEach(walk)
      }
      if (s.type === 'array') walk(s.items as Record<string, unknown>)
    }
    for (const t of AGENT_TOOLS) {
      expect(t.strict).toBe(true)
      walk(t.input_schema as unknown as Record<string, unknown>)
    }
  })
})

describe('tools on the Maneadero demo field', () => {
  it('evaluate_rotation reproduces the engine run for the current rotation', async () => {
    const [ev] = evaluateSlots(input, [{ slots: DEFAULT_CURRENT }])
    const current = result.strategies.find((s) => s.type === 'current')!
    expect(ev.metrics!.waterMm).toBeCloseTo(current.metrics.waterMm, 6)
    expect(ev.metrics!.erosionT).toBeCloseTo(current.metrics.erosionT, 6)
  })

  it('get_field_overview and get_options return figures, gaps and sources', async () => {
    const overview = await call('get_field_overview', {})
    expect(overview.isError).toBe(false)
    expect(overview.json.climate.by_month).toHaveLength(12)
    expect(overview.json.information_gaps.length).toBeGreaterThan(0)
    const options = await call('get_options', {})
    expect(options.json.options[0].option).toBe('current')
    const best = options.json.options.find((o: { option: string }) => o.option === 'best')
    expect(typeof best.change_versus_current_rotation.irrigation_change_pct).toBe('number')
    expect(options.sources.length).toBeGreaterThan(0)
  })

  it('a quoted change from get_options passes the number check', async () => {
    const options = await call('get_options', {})
    const ledger: Ledger = []
    addToLedger(ledger, options.content)
    const best = options.json.options.find((o: { option: string }) => o.option === 'best')
    const pct = Math.abs(best.change_versus_current_rotation.irrigation_change_pct)
    expect(checkAnswer(`La mejor opción usa ${pct}% menos agua de riego.`, ledger).unverified).toEqual([])
  })

  it("evaluate_rotation tests a farmer's idea and reports rule problems", async () => {
    const out = await call('evaluate_rotation', { slots: ['tomato', 'none', 'tomato', 'none', 'tomato', 'none'] })
    expect(out.isError).toBe(false)
    expect(out.json.rule_problems.join(' ')).toMatch(/follows itself/)
    expect(out.json.figures.irrigation_mm_per_year).toBeGreaterThan(0)
  })

  it('compare_rotations, test_climate and season_plan run on options and custom rotations', async () => {
    const cmp = await call('compare_rotations', { a: { option: 'current', slots: [] }, b: { option: 'best', slots: [] } })
    expect(cmp.json.b_versus_a.irrigation_change_pct).not.toBeNull()
    const hot = await call('test_climate', { target: { option: 'current', slots: [] }, warmer_c: 2, rain_change_pct: -20 })
    expect(hot.json.scenario_versus_observed.irrigation_change_pct).toBeGreaterThan(0)
    const plan = await call('season_plan', { target: { option: 'best', slots: [] } })
    expect(plan.json.tasks.length).toBeGreaterThan(3)
    expect(plan.json.tasks[0].when).toMatch(/^Year \d/)
  })

  it('crop_info returns sourced crop data and show_on_land drives the 3D view', async () => {
    const crop = await call('crop_info', { crop: 'vetch' })
    expect(crop.json.name_es).toBe('Veza (cobertura)')
    expect(crop.sources.some((s) => /SARE/.test(s))).toBe(true)
    const shown = await call('show_on_land', { option: 'best', layer: 'water' })
    expect(shown.isError).toBe(false)
    expect(showOnLand).toHaveBeenCalledWith('best', 'water')
  })

  it('rejects bad input as an error result instead of guessing', async () => {
    expect((await call('evaluate_rotation', { slots: ['tomato'] })).isError).toBe(true)
    expect((await call('crop_info', { crop: 'unicorn' })).isError).toBe(true)
    expect((await call('test_climate', { target: { option: 'best', slots: [] }, warmer_c: 9, rain_change_pct: 0 })).isError).toBe(true)
    expect((await call('nope', {})).isError).toBe(true)
  })
})

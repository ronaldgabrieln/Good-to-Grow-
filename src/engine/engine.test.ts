import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CROPS, CROP_BY_ID } from './crops'
import { et0PenmanMonteith, extraterrestrialRadiation } from './et0'
import { computeFeatures } from './features'
import { DEFAULT_CURRENT, DEFAULT_FIELD, DEFAULT_PRIORITIES, describeSlots, runEngine, type FieldData } from './index'
import { checkRotation, evaluateRotation, pestAnalysis } from './rotation'
import { createContext, lsFactor, salinityResponse } from './simulate'
import { buildSoil, parseSoilGrids } from './soil'
import { blendColumns, prepareWeather, qcRain, type PowerColumns } from './weather'

const bundle = JSON.parse(
  readFileSync(path.join(__dirname, '..', '..', 'public', 'data', 'maneadero-demo.json'), 'utf8'),
) as { power: PowerColumns; soilgrids: unknown }
const data: FieldData = { power: bundle.power, soil: parseSoilGrids(bundle.soilgrids)!, source: 'demo', notes: [] }

describe('FAO-56 reference ET', () => {
  it('matches Example 8 extraterrestrial radiation (20°S, 3 Sept → 32.2 MJ/m²/day)', () => {
    expect(extraterrestrialRadiation(-20, 246)).toBeCloseTo(32.2, 1)
  })
  it('matches Example 18 (Brussels, 6 July → 3.9 mm/day)', () => {
    const et0 = et0PenmanMonteith({ tmax: 21.5, tmin: 12.3, rs: 22.07, ea: 1.409, u2: 2.078, latDeg: 50.8, doy: 187, elevationM: 100 })
    expect(et0).toBeGreaterThan(3.8)
    expect(et0).toBeLessThan(4.0)
  })
})

describe('data quality', () => {
  it('removes the implausible June 2020 rain spell and reports it', () => {
    const w = prepareWeather(data.power, 'demo', 20)
    expect(w.rainFlags.length).toBeGreaterThan(0)
    expect(w.rainFlags[0].start.startsWith('2020-06')).toBe(true)
    const june = w.rain.filter((_, i) => w.month[i] === 6).reduce((a, b) => a + b, 0) / 30
    expect(june).toBeLessThan(10)
  })
  it('leaves ordinary storms alone', () => {
    const r: number[] = Array.from({ length: 400 }, (_, i) => (i % 9 === 0 ? 20 : 0))
    r[100] = 70
    expect(qcRain(r, '2000-01-01').flags.length).toBe(0)
  })
  it('blends cells day by day', () => {
    const a = { ...data.power, tmax: [10, 20], tmin: [0, 0], rain: [0, 0], rad: [1, 1], rh: [50, 50], wind: [1, 1], gridElevationM: 0 }
    const b = { ...a, tmax: [20, 30], gridElevationM: 500 }
    const m = blendColumns([a, b], 31, -116)
    expect(m.tmax).toEqual([15, 25])
    expect(m.cells?.length).toBe(2)
  })
})

describe('soil', () => {
  it('classifies and derives water capacity for Maneadero sandy loam', () => {
    expect(['sandy loam', 'sandy clay loam']).toContain(data.soil.textureClass)
    expect(data.soil.awcMmPerM).toBeGreaterThan(80)
    expect(data.soil.awcMmPerM).toBeLessThan(180)
    expect(data.soil.kFactor).toBeGreaterThan(0.01)
    expect(data.soil.kFactor).toBeLessThan(0.06)
  })
  it('clay soil holds more water than sand', () => {
    expect(buildSoil(20, 40, 10, 7, 'default').thetaFC).toBeGreaterThan(buildSoil(85, 5, 10, 7, 'default').thetaFC)
  })
})

describe('crop table', () => {
  it('has complete, sane entries', () => {
    expect(CROPS.length).toBeGreaterThanOrEqual(30)
    for (const c of CROPS) {
      expect(Object.keys(c.plant).length, c.id).toBeGreaterThan(0)
      expect(c.stages.every((s) => s >= 0), c.id).toBe(true)
      expect(c.p, c.id).toBeGreaterThan(0)
      expect(c.p, c.id).toBeLessThan(1)
    }
  })
  it('salinity: barley tolerates 3 dS/m well water, strawberry does not', () => {
    expect(salinityResponse(CROP_BY_ID.barley, 3).factor).toBe(1)
    expect(salinityResponse(CROP_BY_ID.strawberry, 3).factor).toBeLessThan(0.5)
  })
})

describe('rotation rules', () => {
  it('rejects overlapping and same-family sequences', () => {
    expect(checkRotation(['tomato', 'vetch', 'squash', null, 'drybean', null]).ok).toBe(true)
    expect(checkRotation(['tomato', null, 'pepper', null, 'squash', null]).ok).toBe(false)
    expect(checkRotation([null, 'strawberry', 'tomato', null, 'squash', null]).ok).toBe(false)
    expect(checkRotation(['tomato', 'potato', null, 'lettuce', 'squash', null]).ok).toBe(false)
  })
  it('penalizes short Solanaceae returns', () => {
    const tight = pestAnalysis(['tomato', null, 'pepper', null, 'tomato', null])
    const loose = pestAnalysis(['tomato', 'vetch', 'greenbean', 'broccoli', 'squash', 'phacelia'])
    expect(tight.score).toBeLessThan(loose.score)
  })
  it('LS factor grows with slope', () => {
    expect(lsFactor(8, 100)).toBeGreaterThan(lsFactor(2, 100))
  })
})

describe('history replay on Maneadero data', () => {
  const w = prepareWeather(data.power, 'demo', DEFAULT_FIELD.elevationM)
  const ctx = createContext(w, data.soil, DEFAULT_FIELD)

  it('climate features look like coastal Baja California', () => {
    const f = computeFeatures(w)
    expect(f.rainMedianMm).toBeGreaterThan(100)
    expect(f.rainMedianMm).toBeLessThan(400)
    expect(f.rainySeasonShare).toBeGreaterThan(0.65)
    expect(f.et0AnnualMm).toBeGreaterThan(1000)
  })

  it('a winter cover uses less irrigation than an irrigated summer cover', () => {
    const winter = evaluateRotation(ctx, ['tomato', 'vetch', 'squash', 'barleyvetch', 'greenbean', 'vetch'])!
    const summer = evaluateRotation(ctx, ['tomato', null, 'sudangrass', 'broccoli', 'greenbean', null])!
    expect(winter.metrics.bareRainyDays).toBeLessThan(summer.metrics.bareRainyDays)
  })

  it('more water is needed in a hotter, drier scenario', () => {
    const hot = prepareWeather(data.power, 'demo', 20, { deltaTempC: 2, rainChange: -0.2 })
    const ctxHot = createContext(hot, data.soil, DEFAULT_FIELD)
    const slots = ['tomato', 'greenonion', 'pepper', 'cilantro', 'tomato', null]
    expect(evaluateRotation(ctxHot, slots)!.metrics.waterMm).toBeGreaterThan(evaluateRotation(ctx, slots)!.metrics.waterMm)
  })

  it('runEngine returns the current rotation plus 3 valid alternatives with cards', () => {
    const r = runEngine({ data, field: DEFAULT_FIELD, scenario: { deltaTempC: 0, rainChange: 0 }, priorities: DEFAULT_PRIORITIES, current: DEFAULT_CURRENT })
    expect(r.strategies[0].rotation.isCurrent).toBe(true)
    expect(r.strategies.length).toBe(4)
    for (const s of r.strategies.slice(1)) {
      expect(checkRotation(s.rotation.slots).ok).toBe(true)
      expect(s.card.why.length).toBeGreaterThan(0)
      expect(s.card.evidence.length).toBeGreaterThan(0)
    }
    console.log(`engine: ${r.elapsedMs.toFixed(0)} ms, pool ${r.poolSize}`)
    for (const s of r.strategies) {
      const m = s.metrics
      console.log(
        `${s.type.padEnd(12)} #${s.rank} ${s.total.toFixed(1).padStart(5)} | ${describeSlots(s.rotation.slots)}\n       water ${m.waterMm.toFixed(0)} mm, income ${m.income.toFixed(1)}, C ${m.soilCarbon.toFixed(2)}, N ${m.nitrogenKg.toFixed(0)}, eros ${m.erosionT.toFixed(2)}, pest ${m.pestScore}, risk ${(m.failureRisk * 100).toFixed(0)}%, bareRainy ${m.bareRainyDays.toFixed(0)} | ${s.card.headline}`,
      )
    }
  })
})

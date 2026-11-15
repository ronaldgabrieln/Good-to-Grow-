import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fitDrainage, parseNodeCsv, pctOfCapacity, summarizeGround } from './ground'

const csv = readFileSync(path.join(__dirname, '..', '..', 'public', 'data', 'ground', 'node-2026-11-15.csv'), 'utf8')

describe('field node ground truth', () => {
  it('parses the live recorder CSV (empty temperature, PC time)', () => {
    const r = parseNodeCsv(csv)
    expect(r.length).toBeGreaterThan(5000)
    expect(r[0].tempC).toBeNull()
    expect(r[0].soilRaw).toBeGreaterThan(600)
  })
  it('parses the EEPROM dump shape too', () => {
    const r = parseNodeCsv('time,temp_c,temp_src,rh_pct,soil_raw,soil_pct\n2026-11-15 00:07:33,21.5,ds3231,,688,100.0\n# end\n')
    expect(r).toEqual([{ t: Date.UTC(2026, 10, 15, 0, 7, 33), soilRaw: 688, tempC: 21.5, rhPct: null }])
  })
  it('recovers a known drainage curve', () => {
    const s = Array.from({ length: 400 }, (_, i) => ({ t: i * 60000, raw: 590 + 100 * Math.exp(-i / 60 / 2.5) }))
    const f = fitDrainage(s)!
    expect(f.fcRaw).toBeCloseTo(590, 0)
    expect(f.tauH).toBeCloseTo(2.5, 1)
    expect(f.settled).toBe(true)
  })
  it('summarizes the 2026-11-15 night as soil draining', () => {
    const g = summarizeGround(parseNodeCsv(csv))!
    expect(g.hours).toBeGreaterThan(7)
    expect(g.maxGapMin).toBeLessThan(1)
    expect(g.rawEnd).toBeLessThan(g.rawStart)
    expect(g.fit).not.toBeNull()
    expect(g.fit!.t0).toBe(g.peakMs)
    expect(g.peakRaw).toBe(Math.max(...g.series.map((p) => p.raw)))
    expect(pctOfCapacity(g.peakRaw, g.peakRaw)).toBe(100)
    expect(pctOfCapacity(g.rawEnd, g.peakRaw)).toBeLessThan(100)
  })
})

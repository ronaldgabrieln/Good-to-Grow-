import type { Soil } from './types'

export function soilGridsUrl(lat: number, lon: number): string {
  return (
    `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon.toFixed(4)}&lat=${lat.toFixed(4)}` +
    ['clay', 'sand', 'silt', 'soc', 'phh2o'].map((p) => `&property=${p}`).join('') +
    ['0-5cm', '5-15cm', '15-30cm', '30-60cm'].map((d) => `&depth=${d}`).join('') +
    '&value=mean'
  )
}

/** USDA texture triangle (simplified boundaries). */
export function textureClass(sand: number, clay: number): string {
  const silt = 100 - sand - clay
  if (silt + 1.5 * clay < 15) return 'sand'
  if (silt + 1.5 * clay >= 15 && silt + 2 * clay < 30) return 'loamy sand'
  if ((clay >= 7 && clay < 20 && sand > 52 && silt + 2 * clay >= 30) || (clay < 7 && silt < 50 && silt + 2 * clay >= 30))
    return 'sandy loam'
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return 'loam'
  if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) return 'silt loam'
  if (silt >= 80 && clay < 12) return 'silt'
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return 'sandy clay loam'
  if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return 'clay loam'
  if (clay >= 27 && clay < 40 && sand <= 20) return 'silty clay loam'
  if (clay >= 35 && sand > 45) return 'sandy clay'
  if (clay >= 40 && silt >= 40) return 'silty clay'
  return 'clay'
}

/** Saxton & Rawls (2006) pedotransfer functions. sand/clay as fractions, om in % by weight. */
export function saxtonRawls(sandPct: number, clayPct: number, omPct: number): { fc: number; wp: number } {
  const S = sandPct / 100
  const C = clayPct / 100
  const OM = Math.min(8, omPct)
  const t1500 = -0.024 * S + 0.487 * C + 0.006 * OM + 0.005 * S * OM - 0.013 * C * OM + 0.068 * S * C + 0.031
  const wp = t1500 + (0.14 * t1500 - 0.02)
  const t33 = -0.251 * S + 0.195 * C + 0.011 * OM + 0.006 * S * OM - 0.027 * C * OM + 0.452 * S * C + 0.299
  const fc = t33 + (1.283 * t33 * t33 - 0.374 * t33 - 0.015)
  return { fc, wp }
}

/** EPIC soil erodibility (Williams 1995), converted to SI t·ha·h/(ha·MJ·mm). */
export function epicKFactor(sandPct: number, siltPct: number, clayPct: number, ocPct: number): number {
  const sn1 = 1 - sandPct / 100
  const fcsand = 0.2 + 0.3 * Math.exp(-0.256 * sandPct * (1 - siltPct / 100))
  const fclsi = Math.pow(siltPct / Math.max(1, clayPct + siltPct), 0.3)
  const forgc = 1 - (0.25 * ocPct) / (ocPct + Math.exp(3.72 - 2.95 * ocPct))
  const fhisand = 1 - (0.7 * sn1) / (sn1 + Math.exp(-5.51 + 22.9 * sn1))
  return fcsand * fclsi * forgc * fhisand * 0.1317
}

export function buildSoil(
  sandPct: number,
  clayPct: number,
  socGkg: number,
  ph: number,
  source: Soil['source'],
): Soil {
  const siltPct = Math.max(0, 100 - sandPct - clayPct)
  const omPct = (socGkg / 10) * 1.724
  const { fc, wp } = saxtonRawls(sandPct, clayPct, omPct)
  return {
    source,
    sandPct,
    clayPct,
    siltPct,
    socGkg,
    ph,
    textureClass: textureClass(sandPct, clayPct),
    thetaFC: fc,
    thetaWP: wp,
    awcMmPerM: Math.max(40, (fc - wp) * 1000),
    kFactor: epicKFactor(sandPct, siltPct, clayPct, socGkg / 10),
  }
}

/** Fallback when SoilGrids is unreachable: Maneadero valley values fetched 2026-11 (sandy loam). */
export const DEFAULT_SOIL = buildSoil(53, 19, 10.8, 7.4, 'default')

interface SoilGridsLayer {
  name: string
  unit_measure: { d_factor: number }
  depths: { label: string; range: { top_depth: number; bottom_depth: number }; values: { mean: number | null } }[]
}

/** Parse a SoilGrids v2 properties/query response, averaging 0–30 cm by layer thickness. */
export function parseSoilGrids(json: unknown): Soil | null {
  const layers = (json as { properties?: { layers?: SoilGridsLayer[] } })?.properties?.layers
  if (!layers) return null
  const avg = (name: string): number | null => {
    const layer = layers.find((l) => l.name === name)
    if (!layer) return null
    let sum = 0
    let w = 0
    for (const d of layer.depths) {
      if (d.range.top_depth >= 30 || d.values.mean == null) continue
      const thick = Math.min(30, d.range.bottom_depth) - d.range.top_depth
      sum += (d.values.mean / layer.unit_measure.d_factor) * thick
      w += thick
    }
    return w > 0 ? sum / w : null
  }
  // SoilGrids mapped units: texture g/kg (d_factor 10 → %), SOC dg/kg (→ g/kg), pH×10.
  const sand = avg('sand')
  const clay = avg('clay')
  const soc = avg('soc')
  const ph = avg('phh2o')
  if (sand == null || clay == null) return null
  return buildSoil(sand, clay, soc ?? 10, ph ?? 7, 'soilgrids')
}

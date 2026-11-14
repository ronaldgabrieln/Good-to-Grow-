import { CROP_BY_ID, SOURCES } from './crops'
import type { ClimateFeatures } from './features'
import { seasonOf, yearOf } from './rotation'
import { PRIORITY_KEYS, PRIORITY_LABELS, weightsOf } from './score'
import type {
  CriterionScores,
  CropEventSummary,
  EvidenceItem,
  FieldInput,
  Priorities,
  PriorityKey,
  RotationMetrics,
  Slots,
  Soil,
  StrategyCard,
  StrategyType,
  WeatherSeries,
} from './types'

// Every sentence on a card is built from a computed number. Nothing here is free text from a model,
// so a card cannot claim something the engine did not calculate.

export const slotLabel = (slot: number) => `Year ${yearOf(slot) + 1} ${seasonOf(slot) === 'A' ? 'spring' : 'fall'}`
const cropName = (id: string | null) => (id ? CROP_BY_ID[id].name : 'bare / fallow')
const fmt = (v: number, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })
const pct = (a: number, b: number) => (b === 0 ? 0 : ((a - b) / Math.abs(b)) * 100)

export function rotationLabel(slots: Slots): string {
  return slots.filter(Boolean).map((id) => CROP_BY_ID[id!].name.replace(/ \(.*\)$/, '')).join(' → ')
}

interface Delta {
  key: PriorityKey
  text: string
  better: boolean
  magnitude: number
}

function deltas(m: RotationMetrics, base: RotationMetrics): Delta[] {
  const out: Delta[] = []
  const waterDiff = base.waterMm - m.waterMm
  out.push({
    key: 'water',
    better: waterDiff > 0,
    magnitude: Math.abs(pct(m.waterMm, base.waterMm)),
    text: `${waterDiff > 0 ? 'Uses' : 'Needs'} ${fmt(Math.abs(waterDiff) * 10)} m³/ha per year ${waterDiff > 0 ? 'less' : 'more'} irrigation water (${fmt(m.waterMm)} vs ${fmt(base.waterMm)} mm/yr)`,
  })
  const incDiff = pct(m.income, base.income)
  out.push({
    key: 'income',
    better: incDiff > 0,
    magnitude: Math.abs(incDiff),
    text: `Relative income index ${incDiff >= 0 ? '+' : ''}${fmt(incDiff)}% (${fmt(m.income, 1)} vs ${fmt(base.income, 1)} per year)`,
  })
  const cDiff = pct(m.soilCarbon, base.soilCarbon)
  out.push({
    key: 'soil',
    better: cDiff > 0,
    magnitude: Math.abs(cDiff),
    text: `Returns ${fmt(m.residueT, 1)} t/ha/yr of residue vs ${fmt(base.residueT, 1)} (${cDiff >= 0 ? '+' : ''}${fmt(cDiff)}% soil carbon input)`,
  })
  const nDiff = base.nitrogenKg - m.nitrogenKg
  out.push({
    key: 'nitrogen',
    better: nDiff > 0,
    magnitude: Math.abs(pct(m.nitrogenKg, base.nitrogenKg)),
    text: `Needs ${fmt(m.nitrogenKg)} kg N/ha/yr of fertilizer vs ${fmt(base.nitrogenKg)} (${nDiff >= 0 ? '−' : '+'}${fmt(Math.abs(nDiff))} kg)`,
  })
  const eDiff = pct(m.erosionT, base.erosionT)
  out.push({
    key: 'erosion',
    better: eDiff < 0,
    magnitude: Math.abs(eDiff),
    text: `Modeled soil loss ${eDiff <= 0 ? '' : '+'}${fmt(eDiff)}% (${fmt(m.erosionT, 2)} vs ${fmt(base.erosionT, 2)} t/ha/yr); bare during ${fmt(m.bareRainyDays)} rainy-season days/yr vs ${fmt(base.bareRainyDays)}`,
  })
  out.push({
    key: 'pest',
    better: m.pestScore > base.pestScore,
    magnitude: Math.abs(m.pestScore - base.pestScore),
    text: `Pest/disease break score ${fmt(m.pestScore)} vs ${fmt(base.pestScore)} out of 100`,
  })
  const rDiff = (m.failureRisk - base.failureRisk) * 100
  out.push({
    key: 'risk',
    better: rDiff < 0,
    magnitude: Math.abs(rDiff),
    text: `A crop failed in ${fmt(m.failureRisk * 100)}% of replayed cycles vs ${fmt(base.failureRisk * 100)}%`,
  })
  return out
}

export interface CardInput {
  slots: Slots
  type: StrategyType
  metrics: RotationMetrics
  scores: CriterionScores
  events: CropEventSummary[]
  rank: number
  poolSize: number
  isCurrent: boolean
  current: { slots: Slots; metrics: RotationMetrics }
  priorities: Priorities
  features: ClimateFeatures
  weather: Pick<WeatherSeries, 'lat' | 'lon' | 'gridElevationM' | 'cells' | 'rainFlags'>
  soil: Soil
  field: FieldInput
  bestAt: PriorityKey[]
}

export function buildCard(x: CardInput): StrategyCard {
  const w = weightsOf(x.priorities)
  const topPriorities = PRIORITY_KEYS.filter((k) => w[k] > 0)
    .sort((a, b) => w[b] - w[a])
    .slice(0, 3)
  const ds = deltas(x.metrics, x.current.metrics)
  const why: string[] = []
  const benefits: string[] = []
  const tradeoffs: string[] = []

  if (x.isCurrent) {
    why.push(`This is your current rotation, kept as the baseline so every alternative is compared with what you already do.`)
  } else {
    if (x.type === 'small-change') why.push(`Smallest step: changes at most 2 seasons of what you already grow.`)
    if (x.type === 'different') why.push(`A different approach, shown so you can compare another way to meet your goals.`)
    why.push(
      `Ranked #${x.rank} of ${x.poolSize} rotations the engine generated and replayed, weighted by your priorities (${topPriorities
        .map((k) => PRIORITY_LABELS[k].toLowerCase())
        .join(', ')}).`,
    )
    const changes = x.slots
      .map((id, i) => (id !== (x.current.slots[i] ?? null) ? `${slotLabel(i)}: ${cropName(x.current.slots[i] ?? null)} → ${cropName(id)}` : null))
      .filter(Boolean) as string[]
    if (changes.length) why.push(`Changes from your rotation: ${changes.join('; ')}.`)
    const weighted = ds
      .filter((d) => d.better && w[d.key] > 0)
      .sort((a, b) => w[b.key] * b.magnitude - w[a.key] * a.magnitude)
    if (weighted[0]) why.push(`Biggest gain on what you care about: ${weighted[0].text.charAt(0).toLowerCase()}${weighted[0].text.slice(1)}.`)
  }

  // Mechanisms the farmer can recognize.
  const ids = x.slots.filter(Boolean) as string[]
  const covers = ids.filter((id) => CROP_BY_ID[id].kind === 'cover')
  const legumes = ids.filter((id) => CROP_BY_ID[id].nCreditKg > 0)
  if (covers.length)
    why.push(
      `${covers.map((id) => CROP_BY_ID[id].name).join(', ')} ${covers.length > 1 ? 'protect' : 'protects'} the soil when your field would otherwise be bare.`,
    )
  if (legumes.length && !x.isCurrent)
    why.push(`${legumes.map((id) => CROP_BY_ID[id].name).join(', ')} ${legumes.length > 1 ? 'fix' : 'fixes'} nitrogen that the next crop uses, so less fertilizer is bought.`)

  if (!x.isCurrent) {
    for (const d of ds) {
      if (d.magnitude < 2) continue
      ;(d.better ? benefits : tradeoffs).push(d.text)
    }
  } else {
    benefits.push(`Familiar crops and markets: no new equipment, seed or buyers needed.`)
  }

  // Evidence.
  const f = x.features
  const evidence: EvidenceItem[] = [
    {
      text: `Replayed against ${x.metrics.cyclesReplayed} start years of daily weather (${f.firstYear}–${f.lastYear}) at ${x.weather.lat.toFixed(2)}, ${x.weather.lon.toFixed(2)}`,
      source: SOURCES.power,
      provenance: 'observed',
    },
    {
      text: `Median rain ${fmt(f.rainMedianMm)} mm/yr (dry years ${fmt(f.rainP10Mm)} mm), ${fmt(f.rainySeasonShare * 100)}% falling Nov–Mar; reference ET₀ ${fmt(f.et0AnnualMm)} mm/yr`,
      source: SOURCES.power,
      provenance: 'observed',
    },
    {
      text: `Irrigation need ${fmt(x.metrics.waterMm)} mm/yr on average, ${fmt(x.metrics.waterDryYearMm)} mm in the driest 10% of cycles`,
      source: `FAO-56 Penman–Monteith ET₀ + soil-water balance; ${SOURCES.fao56}`,
      provenance: 'modeled',
    },
    {
      text: `Soil: ${x.soil.textureClass}, ${fmt(x.soil.sandPct)}% sand, ${fmt(x.soil.clayPct)}% clay, SOC ${fmt(x.soil.socGkg, 1)} g/kg → ${fmt(x.soil.awcMmPerM)} mm water per m of root zone`,
      source: x.soil.source === 'soilgrids' ? SOURCES.soilgrids : 'Default Maneadero soil (SoilGrids, cached)',
      provenance: 'modeled',
    },
    {
      text: `Erosion ${fmt(x.metrics.erosionT, 2)} t/ha/yr at ${x.field.slopePct}% slope, K = ${x.soil.kFactor.toFixed(3)}`,
      source: SOURCES.rusle,
      provenance: 'modeled',
    },
  ]
  const risks: string[] = []
  for (const e of x.events) {
    const c = CROP_BY_ID[e.cropId]
    const n = e.yearsReplayed
    if (e.heatYears > 0)
      risks.push(`${c.name} (${slotLabel(e.slot)}): ≥3 days above ${c.heatStressC} °C during flowering/heading in ${e.heatYears} of ${n} years.`)
    if (e.frostYears > 0) risks.push(`${c.name}: damaging frost (≤ ${c.frostKillC} °C) in ${e.frostYears} of ${n} years.`)
    if (e.salinityFactor < 0.95)
      risks.push(
        `${c.name} is salt-sensitive: with ${x.field.wellEcDsM} dS/m well water, expected yield is ~${fmt(e.salinityFactor * 100)}% even with extra leaching water.`,
      )
    if (e.failedYears > 0) risks.push(`${c.name}: modeled yield below 60% in ${e.failedYears} of ${n} years.`)
    if (e.heatYears > 0 || e.frostYears > 0 || e.salinityFactor < 0.95) {
      evidence.push({
        text: `${c.name} in ${slotLabel(e.slot)}: mean modeled yield factor ${fmt(e.meanYieldFactor * 100)}%, leaching fraction ${fmt(e.leachingFraction * 100)}%`,
        source: `${SOURCES.power}; ${c.salinity.estimated ? 'salinity values estimated by analogy' : SOURCES.fao29}`,
        provenance: 'modeled',
      })
    }
  }
  const rainfedCovers = covers.filter((id) => CROP_BY_ID[id].irrigation === 'establish')
  if (rainfedCovers.length)
    risks.push(
      `Rain-fed cover establishment: Nov–Dec rain was under 25 mm in ${f.poorFallRainYears} of ${f.nYears} years; plan one establishment irrigation (modeled as 25 mm).`,
    )
  for (const note of x.metrics.pestNotes) if (/returns|bridge/.test(note)) risks.push(note + '.')

  const cells = x.weather.cells
  const gaps: string[] = [
    cells.length > 1
      ? `NASA POWER cells are ~50 km wide. Your field sits between a coastal cell (${fmt(Math.min(...cells.map((c) => c.elevationM)))} m) and an inland cell (${fmt(Math.max(...cells.map((c) => c.elevationM)))} m), so both are averaged; nights are likely milder and days cooler than the valley floor in some months. Compare with a local station.`
      : `NASA POWER cells are ~50 km wide (cell elevation ${fmt(x.weather.gridElevationM)} m vs your field at ${x.field.elevationM} m), so local frost pockets and sea breezes are smoothed out. Compare with a local station.`,
    `Soil comes from SoilGrids (250 m, modeled). A lab test of texture, organic matter and EC on this field would replace it.`,
    `Income uses a relative market index, not real prices or contracts.`,
    `Residue left on the surface after harvest or cover termination is not counted as erosion protection, so covers are credited conservatively.`,
  ]
  if (rainfedCovers.length) gaps.push(`Cover-crop growth on winter rain is modeled; SMAP root-zone soil moisture (~9 km pixels) could validate fall soil moisture.`)
  for (const fl of x.weather.rainFlags)
    gaps.push(
      `Data quality: an implausible ${fmt(fl.totalMm)} mm rain spell (${fl.start} → ${fl.end}, peak ${fmt(fl.peakMm)} mm/day) in the NASA POWER record was removed before replay.`,
    )
  if (x.field.wellEcDsM > 0) gaps.push(`Well salinity (${x.field.wellEcDsM} dS/m) is your input; aquifer trends (GRACE/GRACE-FO, CONAGUA well records) are not yet included.`)

  const ext: string[] = []
  if (rainfedCovers.length) ext.push('cover-crop seed, sowing date and termination timing')
  const newCash = ids.filter((id) => CROP_BY_ID[id].kind !== 'cover' && !x.current.slots.includes(id))
  if (newCash.length) ext.push(`buyers and prices for ${newCash.map((id) => CROP_BY_ID[id].name.toLowerCase()).join(', ')}`)
  if (x.events.some((e) => e.leachingFraction > 0.15)) ext.push('leaching and salinity management with your well water')
  if (x.metrics.pestNotes.some((n) => /returns/.test(n))) ext.push('local pest and disease history for repeated plant families')
  if (ext.length === 0) ext.push('whether these modeled numbers match what you see in your field')

  const headline = x.isCurrent
    ? 'Your current rotation'
    : (() => {
        const top = ds.filter((d) => d.better && w[d.key] > 0).sort((a, b) => w[b.key] * b.magnitude - w[a.key] * a.magnitude)
        const label = (d: Delta) => {
          switch (d.key) {
            case 'water':
              return `${fmt(d.magnitude)}% less water`
            case 'income':
              return `${fmt(d.magnitude)}% more income`
            case 'soil':
              return `${fmt(d.magnitude)}% more soil carbon`
            case 'nitrogen':
              return `${fmt(d.magnitude)}% less N fertilizer`
            case 'erosion':
              return `${fmt(d.magnitude)}% less erosion`
            case 'pest':
              return `stronger pest break`
            case 'risk':
              return `fewer failed seasons`
          }
        }
        return top.length ? top.slice(0, 2).map(label).join(', ') : 'Balanced alternative'
      })()

  return {
    headline: headline.charAt(0).toUpperCase() + headline.slice(1),
    why,
    evidence,
    benefits,
    tradeoffs,
    risks: risks.slice(0, 7),
    gaps,
    extension: `Talk to your extension agent (INIFAP or a local agronomist) about ${ext.join('; ')}.`,
    bestAt: x.bestAt,
  }
}

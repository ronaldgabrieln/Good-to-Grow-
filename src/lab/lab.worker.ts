// Behind-the-scenes worker: runs the same engine steps as runEngine, with the debug hooks on, and
// keeps the simulation context so the page can ask for replays and day-by-day traces afterwards.
import { CROPS, CROP_BY_ID, runEngine } from '../engine'
import { computeFeatures } from '../engine/features'
import { canonicalKey, evaluateRotation, seasonOf, windowsOf, yearOf } from '../engine/rotation'
import { generateCandidates, neighborhood, scorePool, type TryEvent } from '../engine/score'
import { createContext, simulatePlanting, tracePlanting, type SimContext } from '../engine/simulate'
import type { Slots } from '../engine/types'
import { prepareWeather } from '../engine/weather'
import type { LabRequest, LabResponse, LabResult, ReplayRow, StageTime, Timeline } from './labTypes'

const CROP_INDEX = new Map(CROPS.map((c, i) => [c.id, i]))
let ctx: SimContext | null = null

const post = (m: LabResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)

/** Growable column store for the timeline. */
function timelineBuilder() {
  let cap = 32768
  let phase = new Uint8Array(cap)
  let depth = new Uint8Array(cap)
  let outcome = new Uint8Array(cap)
  let slots = new Int16Array(cap * 6)
  let reason = new Int16Array(cap)
  let t = new Float32Array(cap)
  const reasons: string[] = []
  const reasonIdx = new Map<string, number>()
  let n = 0
  const t0 = performance.now()
  const grow = () => {
    cap *= 2
    const g8 = (a: Uint8Array) => { const b = new Uint8Array(cap); b.set(a); return b }
    phase = g8(phase)
    depth = g8(depth)
    outcome = g8(outcome)
    const s = new Int16Array(cap * 6); s.set(slots); slots = s
    const r = new Int16Array(cap); r.set(reason); reason = r
    const tt = new Float32Array(cap); tt.set(t); t = tt
  }
  return {
    push(e: TryEvent) {
      if (n >= cap) grow()
      phase[n] = e.phase === 'beam' ? 0 : 1
      depth[n] = e.depth
      // Valid beam rows become kept/pruned once the beam is cut (see markDepth).
      outcome[n] = e.outcome === 'duplicate' ? 0 : e.outcome === 'rule' ? 1 : e.outcome === 'no-sim' ? 2 : e.phase === 'beam' ? 3 : 5
      for (let k = 0; k < 6; k++) {
        const id = e.slots[k]
        slots[n * 6 + k] = k >= e.slots.length ? -2 : id ? (CROP_INDEX.get(id) ?? -1) : -1
      }
      let ri = -1
      if (e.reasons?.length) {
        const txt = e.reasons[0]
        ri = reasonIdx.get(txt) ?? -1
        if (ri < 0) { ri = reasons.length; reasons.push(txt); reasonIdx.set(txt, ri) }
      }
      reason[n] = ri
      t[n] = performance.now() - t0
      n++
    },
    /** After the beam cuts slot `d`, mark which of that slot's valid rows survived. */
    markDepth(d: number, kept: Slots[], from: number) {
      const keys = new Set(kept.map((s) => s.join(',')))
      for (let i = from; i < n; i++) {
        if (phase[i] !== 0 || depth[i] !== d || outcome[i] !== 3) continue
        const key = Array.from(slots.subarray(i * 6, i * 6 + d + 1), (v) => (v >= 0 ? CROPS[v].id : '')).join(',')
        if (keys.has(key)) outcome[i] = 4
      }
    },
    get n() { return n },
    done(): Timeline {
      return { n, phase: phase.slice(0, n), depth: depth.slice(0, n), outcome: outcome.slice(0, n), slots: slots.slice(0, n * 6), reason: reason.slice(0, n), reasons, t: t.slice(0, n) }
    },
  }
}

function run(id: number, input: LabRequest & { kind: 'run' }) {
  const stages: StageTime[] = []
  const stage = (name: string, t0: number, detail: string) => {
    const s = { stage: name, ms: performance.now() - t0, detail }
    stages.push(s)
    post({ kind: 'stage', id, stage: s })
  }
  const { data, field, scenario, priorities, current } = input.input

  let t0 = performance.now()
  const w = prepareWeather(data.power, data.source, field.elevationM, scenario)
  stage('weather', t0, `${w.tmax.length.toLocaleString()} days, ET₀ computed for each, ${w.rainFlags.length} rain spell(s) removed`)

  t0 = performance.now()
  const features = computeFeatures(w)
  stage('features', t0, `${features.monthly.length} months × ${features.nYears} years summarized`)

  t0 = performance.now()
  ctx = createContext(w, data.soil, field)
  stage('context', t0, `erosion and rainy-day prefix sums over ${w.rain.length.toLocaleString()} days`)

  t0 = performance.now()
  const tl = timelineBuilder()
  let depthFrom = 0
  const beamOut = generateCandidates(ctx, priorities, {
    onTry: (e) => tl.push(e),
    onDepth: (d, kept) => {
      tl.markDepth(d, kept, depthFrom)
      depthFrom = tl.n
    },
  })
  const beamTried = tl.n
  stage('beam', t0, `${beamTried.toLocaleString()} partial rotations tried, ${beamOut.length} complete ones kept`)

  t0 = performance.now()
  const neigh = neighborhood(ctx, current, 2, (e) => tl.push(e))
  stage('tweaks', t0, `${(tl.n - beamTried).toLocaleString()} tweaks of today’s rotation tried, ${neigh.length} valid`)

  t0 = performance.now()
  // Same pool assembly as runEngine: merge, drop duplicates and the current rotation, score.
  const currentKey = canonicalKey(current)
  const unique = new Map<string, { slots: Slots; ev: NonNullable<ReturnType<typeof evaluateRotation>>; beam: boolean }>()
  for (const p of beamOut) { const k = canonicalKey(p.slots); if (k !== currentKey && !unique.has(k)) unique.set(k, { ...p, beam: true }) }
  for (const p of neigh) { const k = canonicalKey(p.slots); if (k !== currentKey && !unique.has(k)) unique.set(k, { ...p, beam: false }) }
  const currentEv = evaluateRotation(ctx, current, true)
  const all = [...(currentEv ? [{ slots: current, ev: currentEv, beam: false }] : []), ...unique.values()]
  const { totals } = scorePool(all.map((x) => x.ev.metrics), priorities)
  const points = new Float32Array(all.length * 4)
  all.forEach((x, i) => {
    points[i * 4] = x.ev.metrics.waterMm
    points[i * 4 + 1] = x.ev.metrics.income
    points[i * 4 + 2] = totals[i]
    points[i * 4 + 3] = x.beam ? 1 : 0
  })
  stage('score', t0, `${unique.size.toLocaleString()} unique rotations scored on 7 criteria`)

  t0 = performance.now()
  const engine = runEngine(input.input)
  stage('shortlist', t0, `runEngine end to end (pool ${engine.poolSize.toLocaleString()}), ${engine.strategies.length} plans on the card`)

  const timeline = tl.done()
  const f32 = (a: number[]) => Float32Array.from(a)
  const result: LabResult = {
    weather: {
      start: w.start, startYear: w.startYear, endYear: w.endYear, yearStart: w.yearStart, cells: w.cells, gridElevationM: w.gridElevationM, rainFlags: w.rainFlags,
      tmax: f32(w.tmax), tmin: f32(w.tmin), rain: f32(w.rain), rad: f32(w.rad), rh: f32(w.rh), wind: f32(w.wind), et0: f32(w.et0),
    },
    features,
    soil: data.soil,
    ls: ctx.ls,
    timeline,
    pool: { points, count: unique.size, beamOut: beamOut.length, neighborhoodOut: neigh.length },
    engine,
    stages,
  }
  const W = result.weather
  post({ kind: 'result', id, result }, [
    W.tmax.buffer, W.tmin.buffer, W.rain.buffer, W.rad.buffer, W.rh.buffer, W.wind.buffer, W.et0.buffer,
    timeline.phase.buffer, timeline.depth.buffer, timeline.outcome.buffer, timeline.slots.buffer, timeline.reason.buffer, timeline.t.buffer, points.buffer,
  ])
}

/** The rotation started in each possible year (the same cycles evaluateRotation averages). */
function replay(slots: Slots): ReplayRow[] {
  if (!ctx) return []
  const windows = windowsOf(slots)
  const years = Math.max(1, Math.ceil(slots.length / 2))
  const rows: ReplayRow[] = []
  for (let y0 = ctx.w.startYear; y0 <= ctx.w.endYear - years; y0++) {
    const plantings: ReplayRow['plantings'] = []
    let water = 0
    let income = 0
    let failed = false
    let ok = true
    for (const win of windows) {
      const year = y0 + yearOf(win.slot)
      const s = simulatePlanting(ctx, win.cropId, seasonOf(win.slot), year)
      if (!s) { ok = false; break }
      water += s.irrigationGrossMm
      income += CROP_BY_ID[win.cropId].marketIndex * s.yieldFactor
      if (s.failed) failed = true
      plantings.push({ cropId: win.cropId, slot: win.slot, year, yieldFactor: s.yieldFactor, irrigationMm: s.irrigationGrossMm, frostKill: s.frostKill, heatDays: s.heatDays })
    }
    if (ok) rows.push({ startYear: y0, waterMm: water / years, income: income / years, failed, plantings })
  }
  return rows
}

self.onmessage = (e: MessageEvent<LabRequest>) => {
  const req = e.data
  try {
    if (req.kind === 'run') run(req.id, req)
    else if (req.kind === 'replay') post({ kind: 'replay', id: req.id, rows: replay(req.slots) })
    else post({ kind: 'trace', id: req.id, trace: ctx ? tracePlanting(ctx, req.cropId, req.season, req.year) : null })
  } catch (err) {
    post({ kind: 'error', id: req.id, error: (err as Error).message ?? String(err) })
  }
}

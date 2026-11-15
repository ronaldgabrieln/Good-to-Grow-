// Behind the scenes: a hidden page (only reachable at #behind-the-scenes) that takes a coordinate
// and shows every step the planner runs for it, from the raw NASA requests to the shortlist.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ANALYSIS_START_YEAR, CROP_BY_ID, DEFAULT_CURRENT, DEFAULT_FIELD, DEFAULT_PRIORITIES, DEFAULT_SCENARIO, PRIORITY_KEYS, PRIORITY_LABELS,
  loadFieldData, type EngineInput, type FieldData, type Strategy, type StrategyType,
} from '../engine'
import { seasonOf, yearOf } from '../engine/rotation'
import { soilGridsUrl } from '../engine/soil'
import { powerUrl } from '../engine/weather'
import { findFrames, type Frame } from '../tool/landsatFrames'
import { MapPicker, type PickedPoint } from '../tool/MapPicker'
import { loadTerrain, type Terrain } from '../tool/terrain/terrain'
import { BarChart, LineChart, PoolScatter } from './charts'
import { fmt } from './chartUtils'
import type { LabQuery, LabRequest, LabResponse, LabResult, PlantingTrace, ReplayRow, StageTime } from './labTypes'
import { CombinationsTimeline } from './Timeline'
import '../tool/flow.css'
import './lab.css'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_STARTS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]
const doyLabel = (doy: number, y = 2001) => { const d = new Date(Date.UTC(y, 0, doy)); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}` }
const PLAN_NAME: Record<StrategyType, string> = { current: 'What you do now', 'small-change': 'A small change', best: 'Best for you', different: 'Another way' }
const TERRAIN_TIMEOUT_MS = 25000
const IDLE_REQS: Record<ReqKey, ReqState> = { power: { status: 'waiting' }, soil: { status: 'waiting' }, landsat: { status: 'waiting' }, terrain: { status: 'waiting' } }
const cropName = (id: string) => CROP_BY_ID[id]?.name.replace(/ \(.*\)$/, '') ?? id

type ReqKey = 'power' | 'soil' | 'landsat' | 'terrain'
interface ReqState { status: 'waiting' | 'running' | 'done' | 'fallback' | 'failed'; ms?: number; detail?: string }
const REQ_INFO: Record<ReqKey, { name: string; who: string }> = {
  power: { name: 'NASA POWER daily weather', who: 'NASA Langley · power.larc.nasa.gov' },
  soil: { name: 'SoilGrids soil properties', who: 'ISRIC · rest.isric.org' },
  landsat: { name: 'Landsat scenes, one per year', who: 'NASA/USGS via Microsoft Planetary Computer' },
  terrain: { name: 'SRTM elevation + satellite photo', who: 'AWS Terrain Tiles + Esri World Imagery' },
}

/** Worker wrapper: one run at a time, plus replay/trace requests answered by id. */
function useLabWorker() {
  const worker = useRef<Worker | null>(null)
  const nextId = useRef(0)
  const runId = useRef(0)
  const waiting = useRef(new Map<number, (m: LabResponse) => void>())
  const [stages, setStages] = useState<StageTime[]>([])
  const [result, setResult] = useState<LabResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  useEffect(() => {
    const w = new Worker(new URL('./lab.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<LabResponse>) => {
      const m = e.data
      if (m.kind === 'stage' || m.kind === 'result' || (m.kind === 'error' && m.id === runId.current)) {
        if (m.id !== runId.current) return
        if (m.kind === 'stage') setStages((s) => [...s, m.stage])
        else if (m.kind === 'result') { setResult(m.result); setRunning(false) }
        else { setError(m.error); setRunning(false) }
        return
      }
      waiting.current.get(m.id)?.(m)
      waiting.current.delete(m.id)
    }
    worker.current = w
    return () => w.terminate()
  }, [])
  const run = useCallback((input: EngineInput) => {
    const id = ++nextId.current
    runId.current = id
    setStages([]); setResult(null); setError(null); setRunning(true)
    worker.current?.postMessage({ kind: 'run', id, input } satisfies LabRequest)
  }, [])
  const ask = useCallback((req: LabQuery) => {
    const id = ++nextId.current
    return new Promise<LabResponse>((resolve) => {
      waiting.current.set(id, resolve)
      worker.current?.postMessage({ ...req, id })
    })
  }, [])
  return { run, ask, stages, result, error, running }
}

export default function Lab({ onHome }: { onHome?: () => void }) {
  const [mode, setMode] = useState<'pick' | 'view'>('pick')
  const [picked, setPicked] = useState<PickedPoint | null>(null)
  const [forceLive, setForceLive] = useState(false)
  /** One run of the whole pipeline; a new object starts a new run. */
  const [job, setJob] = useState<{ lat: number; lon: number; forceLive: boolean } | null>(null)
  const [reqs, setReqs] = useState<Record<ReqKey, ReqState>>(IDLE_REQS)
  const [data, setData] = useState<FieldData | null>(null)
  const [terrain, setTerrain] = useState<Terrain | null>(null)
  const [frames, setFrames] = useState<Frame[]>([])
  const [missing, setMissing] = useState<number[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const lab = useLabWorker()
  const { run } = lab
  const urls = useRef<string[]>([])
  const point = job

  const start = (p: { lat: number; lon: number }) => {
    setData(null); setTerrain(null); setFrames([]); setMissing([]); setLoadError(null)
    setReqs({ power: { status: 'running' }, soil: { status: 'running' }, landsat: { status: 'running' }, terrain: { status: 'running' } })
    setJob({ lat: p.lat, lon: p.lon, forceLive })
    setMode('view')
  }

  // 1. Requests, all started at once (as the planner does). 2. The engine runs once weather + soil
  // are in and the terrain has answered or given up, so it uses the real SRTM slope.
  useEffect(() => {
    if (!job) return
    const ctrl = new AbortController()
    const t0 = performance.now()
    const ms = () => Math.round(performance.now() - t0)
    const setReq = (k: ReqKey, st: ReqState) => !ctrl.signal.aborted && setReqs((r) => ({ ...r, [k]: st }))
    let gotData: FieldData | null = null
    let gotTerrain: Terrain | null = null
    let terrainSettled = false
    const maybeRun = () => {
      if (ctrl.signal.aborted || !gotData || !terrainSettled) return
      const field = {
        ...DEFAULT_FIELD,
        lat: job.lat, lon: job.lon, name: 'Behind-the-scenes point',
        elevationM: gotTerrain ? Math.round(gotTerrain.field.elevationM) : DEFAULT_FIELD.elevationM,
        slopePct: gotTerrain ? Math.round(gotTerrain.field.slopePct * 10) / 10 : DEFAULT_FIELD.slopePct,
      }
      run({ data: gotData, field, scenario: DEFAULT_SCENARIO, priorities: DEFAULT_PRIORITIES, current: DEFAULT_CURRENT })
    }

    let weatherDoneAt = 0
    loadFieldData(job.lat, job.lon, { forceLive: job.forceLive, onStep: (st) => { if (st === 'soil') weatherDoneAt = ms() } })
      .then((d) => {
        if (ctrl.signal.aborted) return
        const total = ms()
        const cached = d.source === 'cache'
        const demo = d.source === 'demo'
        const soilFallback = d.soil.source === 'default'
        setReq('power', { status: demo ? 'fallback' : 'done', ms: cached ? total : weatherDoneAt || total, detail: cached ? 'Saved copy in this browser (no request sent). Tick “Skip the saved copy” to fetch live.' : demo ? 'Request failed: using the bundled Maneadero dataset.' : `${d.power.tmax.length.toLocaleString()} days × 6 variables${(d.power.cells?.length ?? 1) > 1 ? `, ${d.power.cells!.length} grid cells averaged` : ''}` })
        setReq('soil', { status: soilFallback ? 'fallback' : 'done', ms: total, detail: cached ? 'Saved copy in this browser.' : soilFallback ? 'No answer in time: default valley soil used.' : `${d.soil.textureClass}, ${fmt(d.soil.sandPct, 1)}% sand, ${fmt(d.soil.clayPct, 1)}% clay` })
        setData(d)
        gotData = d
        maybeRun()
      })
      .catch((e: Error) => !ctrl.signal.aborted && setLoadError(e.message))

    findFrames(job.lat, job.lon, {
      fromYear: ANALYSIS_START_YEAR,
      signal: ctrl.signal,
      onFrame: (f) => { urls.current.push(f.url); setFrames((p) => [...p, f].sort((a, b) => a.year - b.year)) },
      onMissing: (y) => setMissing((p) => (p.includes(y) ? p : [...p, y])),
    })
      .then((fr) => setReq('landsat', { status: 'done', ms: ms(), detail: `${fr.length} clear scenes found` }))
      .catch(() => setReq('landsat', { status: 'failed', ms: ms(), detail: 'Search failed' }))

    let timer = 0
    const timeout = new Promise<never>((_, rej) => { timer = window.setTimeout(() => rej(new Error(`no answer after ${TERRAIN_TIMEOUT_MS / 1000} s`)), TERRAIN_TIMEOUT_MS) })
    Promise.race([loadTerrain(job.lat, job.lon, ctrl.signal), timeout])
      .then((t) => {
        if (ctrl.signal.aborted) return
        setTerrain(t)
        gotTerrain = t
        setReq('terrain', { status: 'done', ms: ms(), detail: `${t.n} × ${t.n} grid, ${fmt(t.minElev)}–${fmt(t.maxElev)} m; field slope ${fmt(t.field.slopePct, 1)}%` })
      })
      .catch((e: Error) => setReq('terrain', { status: 'failed', ms: ms(), detail: `${e.message}: default slope and elevation used` }))
      .finally(() => {
        clearTimeout(timer)
        terrainSettled = true
        maybeRun()
      })

    const owned = urls.current
    return () => {
      ctrl.abort()
      clearTimeout(timer)
      owned.forEach((u) => URL.revokeObjectURL(u))
      owned.length = 0
    }
  }, [job, run])

  if (mode === 'pick' || !point) {
    return (
      <MapPicker
        initialCenter={picked ?? { lat: DEFAULT_FIELD.lat, lon: DEFAULT_FIELD.lon }}
        initialZoom={picked ? 14 : 12}
        picked={picked}
        onPick={setPicked}
        onSetLocation={() => { if (picked) start(picked) }}
        onHome={onHome}
      />
    )
  }

  const r = lab.result
  return (
    <div className="lab">
      <div className="lab-wrap">
        <header className="lab-head">
          <p className="lab-eyebrow">Behind the scenes · not linked from the app</p>
          <h1>What the planner does for one point</h1>
          <p className="lab-lead">Everything below is the real pipeline: the same requests, the same engine code and the same data the planner uses, with debug hooks on so each step can be shown. Current rotation and priorities are the planner’s defaults.</p>
          <CoordForm key={`${point.lat},${point.lon}`} point={point} forceLive={forceLive} onForceLive={setForceLive} onRun={start} onMap={() => setMode('pick')} />
          <Pipeline reqs={reqs} stages={lab.stages} running={lab.running} />
          {(loadError || lab.error) && <p className="lab-error">Something failed: {loadError ?? lab.error}</p>}
        </header>

        <Section n={1} title="Requests to outside services" sub="All four start at the same moment. The engine waits for weather and soil; the terrain is waited for here (up to 25 s) so the run uses its real slope.">
          <div className="lab-reqs">
            {(Object.keys(REQ_INFO) as ReqKey[]).map((k) => (
              <div key={k} className="lab-req">
                <div className="lab-req-h"><b>{REQ_INFO[k].name}</b><StatusPill s={reqs[k]} /></div>
                <span className="lab-note">{REQ_INFO[k].who}</span>
                {k === 'power' && <code className="lab-url">{powerUrl(point.lat, point.lon)}</code>}
                {k === 'soil' && <code className="lab-url">{soilGridsUrl(point.lat, point.lon)}</code>}
                {reqs[k].detail && <span>{reqs[k].detail}</span>}
              </div>
            ))}
          </div>
          {data && data.notes.length > 0 && <ul className="lab-notes">{data.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          <Filmstrip frames={frames} missing={missing} />
          {terrain && <TerrainView terrain={terrain} />}
        </Section>

        {!r ? (
          <p className="lab-wait">{lab.running ? 'The engine is running…' : 'Waiting for the weather, soil and terrain to come back…'}</p>
        ) : (
          <Results result={r} ask={lab.ask} />
        )}
      </div>
    </div>
  )
}

function CoordForm({ point, forceLive, onForceLive, onRun, onMap }: {
  point: { lat: number; lon: number }; forceLive: boolean; onForceLive: (v: boolean) => void
  onRun: (p: { lat: number; lon: number }) => void; onMap: () => void
}) {
  const [lat, setLat] = useState(point.lat.toFixed(5))
  const [lon, setLon] = useState(point.lon.toFixed(5))
  const la = Number(lat), lo = Number(lon)
  const ok = Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 60 && Math.abs(lo) <= 180
  return (
    <form className="lab-form" onSubmit={(e) => { e.preventDefault(); if (ok) onRun({ lat: la, lon: lo }) }}>
      <label>Latitude<input id="lab-lat" value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" /></label>
      <label>Longitude<input id="lab-lon" value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" /></label>
      <label className="lab-check"><input id="lab-live" type="checkbox" checked={forceLive} onChange={(e) => onForceLive(e.target.checked)} />Skip the saved copy</label>
      <button type="submit" className="lab-btn lab-btn--primary" disabled={!ok}>Run for this point</button>
      <button type="button" className="lab-btn" onClick={onMap}>Pick on the map</button>
      {!ok && <span className="lab-error">Enter a latitude within ±60° (SRTM coverage) and a longitude within ±180°.</span>}
    </form>
  )
}

function StatusPill({ s }: { s: ReqState }) {
  const label = { waiting: 'Waiting', running: 'Running…', done: 'Done', fallback: 'Fallback', failed: 'Failed' }[s.status]
  return <span className={`lab-status lab-status--${s.status}`}>{label}{s.ms !== undefined ? ` · ${fmt(s.ms)} ms` : ''}</span>
}

const PIPE: { key: string; label: string; fn: string }[] = [
  { key: 'weather', label: 'Prepare weather', fn: 'prepareWeather' },
  { key: 'features', label: 'Climate features', fn: 'computeFeatures' },
  { key: 'context', label: 'Simulation context', fn: 'createContext' },
  { key: 'beam', label: 'Beam search', fn: 'generateCandidates' },
  { key: 'tweaks', label: 'Tweaks of today’s rotation', fn: 'neighborhood' },
  { key: 'score', label: 'Score the pool', fn: 'scorePool' },
  { key: 'shortlist', label: 'Shortlist + cards', fn: 'runEngine' },
]

function Pipeline({ reqs, stages, running }: { reqs: Record<ReqKey, ReqState>; stages: StageTime[]; running: boolean }) {
  const reqDone = (Object.values(reqs) as ReqState[]).filter((r) => r.status !== 'running' && r.status !== 'waiting').length
  return (
    <ol className="lab-pipe" aria-label="Pipeline progress">
      <li className={reqDone === 4 ? 'is-done' : 'is-active'}>
        <span className="lab-pipe-k">Requests</span><span className="lab-pipe-v">{reqDone} of 4 back</span>
      </li>
      {PIPE.map((p, i) => {
        const s = stages.find((x) => x.stage === p.key)
        const active = running && !s && stages.length === i
        return (
          <li key={p.key} className={s ? 'is-done' : active ? 'is-active' : ''} title={s?.detail}>
            <span className="lab-pipe-k">{p.label}</span>
            <span className="lab-pipe-v">{s ? `${fmt(s.ms, s.ms < 10 ? 1 : 0)} ms` : active ? 'running…' : p.fn}</span>
          </li>
        )
      })}
    </ol>
  )
}

function Section({ n, title, sub, children }: { n: number; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="lab-section">
      <div className="lab-section-h"><span className="lab-n">{n}</span><div><h2>{title}</h2>{sub && <p className="lab-sub">{sub}</p>}</div></div>
      {children}
    </section>
  )
}

function Stats({ items }: { items: [string, string][] }) {
  return <div className="lab-stats">{items.map(([v, k]) => <div key={k} className="lab-stat"><span className="lab-stat-v">{v}</span><span className="lab-stat-k">{k}</span></div>)}</div>
}

function Filmstrip({ frames, missing }: { frames: Frame[]; missing: number[] }) {
  if (!frames.length && !missing.length) return null
  return (
    <div className="lab-fig">
      <div className="lab-fig-h"><h3>Landsat scenes as they arrive</h3><span className="lab-note">{frames.length} found · {missing.length} years with no usable scene</span></div>
      <div className="lab-film">
        {frames.map((f) => (
          <figure key={f.sceneId}>
            <img src={f.url} alt={`Field in ${f.date}, ${f.sensor}`} loading="lazy" />
            <figcaption><b>{f.year}</b> {f.sensor} · {fmt(f.cloud)}% cloud</figcaption>
          </figure>
        ))}
        {[...missing].sort((a, b) => a - b).map((y) => <figure key={y} className="is-missing"><div>no scene</div><figcaption><b>{y}</b></figcaption></figure>)}
      </div>
    </div>
  )
}

function TerrainView({ terrain }: { terrain: Terrain }) {
  return (
    <div className="lab-fig lab-terrain">
      <img src={terrain.imageUrl} alt="Satellite photo of the 6 × 6 km around the point" />
      <div>
        <h3>SRTM terrain around the point</h3>
        <p className="lab-note">6 × 6 km, {terrain.n} × {terrain.n} cells of about {fmt(terrain.cellM)} m. Slope at the field replaces the default 1.5% before the engine runs, and the RUSLE LS factor comes from it.</p>
        <Stats items={[[`${fmt(terrain.field.elevationM)} m`, 'elevation at the point'], [`${fmt(terrain.field.slopePct, 1)}%`, 'slope at the point'], [fmt(terrain.field.ls, 2), 'LS factor (terrain grid)'], [`${fmt(terrain.minElev)}–${fmt(terrain.maxElev)} m`, 'elevation range']]} />
      </div>
    </div>
  )
}

type Ask = ReturnType<typeof useLabWorker>['ask']

function Results({ result, ask }: { result: LabResult; ask: Ask }) {
  const strategies = result.engine.strategies
  const [planIdx, setPlanIdx] = useState(Math.max(0, strategies.findIndex((s) => s.type === 'best')))
  const plan = strategies[planIdx] ?? strategies[0]
  // Answers are stored with the plan they belong to, so a stale one is never shown.
  const [replay, setReplay] = useState<{ id: string; rows: ReplayRow[] } | null>(null)
  const [startYear, setStartYear] = useState(2010)
  const [winIdx, setWinIdx] = useState(0)
  useEffect(() => {
    let live = true
    ask({ kind: 'replay', slots: plan.rotation.slots }).then((m) => { if (live && m.kind === 'replay') setReplay({ id: plan.rotation.id, rows: m.rows }) })
    return () => { live = false }
  }, [plan, ask])
  const replayRows = replay?.id === plan.rotation.id ? replay.rows : null
  return (
    <>
      <WeatherSection w={result.weather} />
      <SoilSection result={result} />
      <FeaturesSection result={result} />
      <Section n={5} title="Every combination the generator tried" sub="Each pixel column is a slice of the search, in the order it ran. Lanes 1–6 are the beam search filling one slot at a time; the last two are the 1- and 2-slot tweaks of today’s rotation. Drag across it, or press Play to replay the search.">
        <Stats items={[
          [fmt(result.timeline.n), 'combinations tried'],
          [fmt(result.pool.beamOut), 'complete rotations from the beam'],
          [fmt(result.pool.neighborhoodOut), 'valid tweaks of today’s rotation'],
          [fmt(result.pool.count), 'unique after removing duplicates'],
        ]} />
        <CombinationsTimeline tl={result.timeline} current={DEFAULT_CURRENT} />
      </Section>
      <Section n={6} title="Pick a plan to follow through the engine" sub="The four plans the card would show. The next three steps use the one you pick.">
        <div className="lab-plans">
          {strategies.map((s, i) => (
            <button type="button" key={s.type} className={`lab-plan${i === planIdx ? ' is-on' : ''}`} onClick={() => { setPlanIdx(i); setWinIdx(0) }} aria-pressed={i === planIdx}>
              <b>{PLAN_NAME[s.type]}</b>
              <span>{s.rotation.label}</span>
              <span className="lab-mono">{fmt(s.metrics.waterMm)} mm/yr · score {fmt(s.total, 1)}</span>
            </button>
          ))}
        </div>
      </Section>
      <ReplaySection plan={plan} rows={replayRows} startYear={startYear} onStartYear={setStartYear} />
      <PlantingSection plan={plan} startYear={startYear} winIdx={winIdx} onWin={setWinIdx} ask={ask} endYear={result.weather.endYear} />
      <ScoringSection result={result} />
    </>
  )
}

function WeatherSection({ w }: { w: LabResult['weather'] }) {
  const years = useMemo(() => Array.from({ length: w.endYear - w.startYear + 1 }, (_, i) => w.startYear + i), [w])
  const annual = useMemo(() => years.map((_, k) => {
    const a = w.yearStart[k], b = w.yearStart[k + 1] ?? w.tmax.length
    let rain = 0, et0 = 0
    for (let i = a; i < b; i++) { rain += w.rain[i]; et0 += w.et0[i] }
    return { rain, et0 }
  }), [w, years])
  const [year, setYear] = useState(2010)
  const k = year - w.startYear
  const a = w.yearStart[k], b = w.yearStart[k + 1] ?? w.tmax.length
  const days = Array.from({ length: b - a }, (_, i) => i + 1)
  const sl = (arr: Float32Array) => arr.subarray(a, b)
  return (
    <Section n={2} title="NASA POWER: from JSON to daily arrays" sub="The response is one dictionary per variable keyed by date. The code sorts the dates into arrays, fills -999 gaps with the day before, averages neighbouring grid cells, removes impossible rain spells, applies the climate sliders and computes ET₀ (FAO-56 Penman–Monteith) for every day.">
      <Stats items={[
        [fmt(w.tmax.length), `days, ${w.startYear}–${w.endYear}`],
        [String(w.cells.length), w.cells.length > 1 ? 'grid cells averaged (field near a cell edge)' : 'grid cell'],
        [w.cells.map((c) => `${fmt(c.elevationM)} m`).join(' / '), 'grid-cell elevation'],
        [String(w.rainFlags.length), 'rain spells removed by the check'],
      ]} />
      {w.rainFlags.length > 0 && <ul className="lab-notes">{w.rainFlags.map((f) => <li key={f.start}>Removed {fmt(f.totalMm)} mm from {f.start} to {f.end} (peak {fmt(f.peakMm, 1)} mm in one day).</li>)}</ul>}
      <div className="lab-fig">
        <div className="lab-fig-h"><h3>Every year: rain against water demand (mm)</h3><Legend items={[['var(--rain)', 'Rain'], ['var(--et0)', 'ET₀']]} /></div>
        <BarChart cats={years.map(String)} series={[{ name: 'Rain', values: annual.map((x) => x.rain), color: 'var(--rain)' }, { name: 'ET₀', values: annual.map((x) => x.et0), color: 'var(--et0)' }]} tipTitle={(i) => String(years[i])} unit=" mm" label="Annual rain and ET0 per calendar year" />
      </div>
      <div className="lab-fig">
        <div className="lab-fig-h">
          <h3>One year, day by day</h3>
          <label className="lab-inline">Year
            <input id="lab-year" type="range" min={w.startYear} max={w.endYear} value={year} onChange={(e) => setYear(Number(e.target.value))} />
            <span className="lab-mono">{year}</span>
          </label>
        </div>
        <Legend items={[['var(--et0)', 'Max temperature'], ['var(--rain)', 'Min temperature']]} />
        <LineChart xs={days} series={[{ name: 'Max', values: sl(w.tmax), color: 'var(--et0)' }, { name: 'Min', values: sl(w.tmin), color: 'var(--rain)' }]} height={180} xTicks={MONTH_STARTS} xFmt={(v) => doyLabel(v).split(' ')[0]} tipTitle={(i) => `${doyLabel(i + 1, year)} ${year}`} unit=" °C" label={`Daily temperature ${year}`} />
        <Legend items={[['var(--rain)', 'Rain (bars)'], ['var(--et0)', 'ET₀ (line)']]} />
        <LineChart xs={days} series={[{ name: 'ET₀', values: sl(w.et0), color: 'var(--et0)' }]} bars={{ name: 'Rain', values: sl(w.rain), color: 'var(--rain)' }} height={170} xTicks={MONTH_STARTS} xFmt={(v) => doyLabel(v).split(' ')[0]} tipTitle={(i) => `${doyLabel(i + 1, year)} ${year}`} unit=" mm" label={`Daily rain and ET0 ${year}`} />
        <p className="lab-note">{year}: {fmt(annual[k].rain)} mm of rain against {fmt(annual[k].et0)} mm of ET₀. Irrigation has to cover the gap.</p>
      </div>
    </Section>
  )
}

function SoilSection({ result }: { result: LabResult }) {
  const s = result.soil
  return (
    <Section n={3} title="SoilGrids: texture becomes a water bucket" sub="The top 30 cm are averaged by layer thickness. Saxton & Rawls gives field capacity and wilting point; their difference is the water the soil holds per metre of roots. The EPIC equation gives erodibility K.">
      <Stats items={[
        [s.source === 'soilgrids' ? 'SoilGrids' : 'Default valley soil', 'source'],
        [`${fmt(s.sandPct, 1)} / ${fmt(s.siltPct, 1)} / ${fmt(s.clayPct, 1)}`, 'sand / silt / clay %'],
        [s.textureClass, 'USDA texture class'],
        [`${fmt(s.thetaFC, 3)} / ${fmt(s.thetaWP, 3)}`, 'field capacity / wilting point'],
        [`${fmt(s.awcMmPerM)} mm/m`, 'available water capacity'],
        [fmt(s.kFactor, 4), 'erodibility K'],
        [`${fmt(s.socGkg, 1)} g/kg · pH ${fmt(s.ph, 1)}`, 'organic carbon · pH'],
        [fmt(result.ls, 3), 'LS factor used by the engine'],
      ]} />
    </Section>
  )
}

function FeaturesSection({ result }: { result: LabResult }) {
  const f = result.features
  const CLS = { dry: 'var(--o1)', typical: 'var(--o2)', wet: 'var(--o3)' } as const
  return (
    <Section n={4} title="computeFeatures: the climate in a few numbers" sub="A summary of the prepared series. It is not fed into the simulation; it writes the cards’ climate sentences and the climate panel.">
      <Stats items={[
        [`${fmt(f.rainMedianMm)} mm`, `median rain (10–90%: ${fmt(f.rainP10Mm)}–${fmt(f.rainP90Mm)})`],
        [`${fmt(f.et0AnnualMm)} mm`, 'median annual ET₀'],
        [fmt(f.aridityIndex, 2), 'aridity index'],
        [`${Math.round(f.rainySeasonShare * 100)}%`, 'of rain falls Nov–Mar'],
        [String(f.dryYears), 'dry years (< 60% of median)'],
        [`${f.frostYears} of ${f.nYears}`, 'years with a frost day'],
        [fmt(f.heatDaysMedian), 'median days ≥ 35 °C'],
        [fmt(f.gddBase10Median), 'growing degree days (base 10)'],
      ]} />
      <div className="lab-fig">
        <div className="lab-fig-h"><h3>Average month (mm)</h3><Legend items={[['var(--rain)', 'Rain'], ['var(--et0)', 'ET₀']]} /></div>
        <BarChart cats={MON} series={[{ name: 'Rain', values: f.monthly.map((m) => m.rainMeanMm), color: 'var(--rain)' }, { name: 'ET₀', values: f.monthly.map((m) => m.et0MeanMm), color: 'var(--et0)' }]} tipTitle={(i) => `${MON[i]} average`} unit=" mm" label="Average monthly rain and ET0" />
      </div>
      <div className="lab-fig">
        <div className="lab-fig-h"><h3>Rain per hydrological year, Oct–Sep (mm)</h3><Legend items={[['var(--o1)', 'Dry third'], ['var(--o2)', 'Typical'], ['var(--o3)', 'Wet third']]} /></div>
        <BarChart cats={f.hydroYears.map((h) => String(h.year))} series={[{ name: 'Rain', values: f.hydroYears.map((h) => h.rainMm), color: 'var(--o2)' }]} colorOf={(i) => CLS[f.hydroYears[i].rainClass]} tipTitle={(i) => `Oct ${f.hydroYears[i].year - 1} – Sep ${f.hydroYears[i].year} · ${f.hydroYears[i].rainClass}`} unit=" mm" refLine={{ value: f.rainMedianMm, label: `median ${fmt(f.rainMedianMm)} mm` }} label="Rain per hydrological year" />
      </div>
    </Section>
  )
}

function ReplaySection({ plan, rows, startYear, onStartYear }: { plan: Strategy; rows: ReplayRow[] | null; startYear: number; onStartYear: (y: number) => void }) {
  if (!rows) return <Section n={7} title="Replaying the plan through history"><p className="lab-wait">Replaying…</p></Section>
  const xs = rows.map((r) => r.startYear)
  const sel = Math.max(0, xs.indexOf(startYear))
  const failed = rows.filter((r) => r.failed)
  return (
    <Section n={7} title="Replaying the plan through history" sub={`evaluateRotation starts the 3-year plan in every year from ${xs[0]} to ${xs[xs.length - 1]} and grows it against that stretch of weather: ${rows.length} replays. The card reports their mean; risk uses the bad tail. Tap a year to follow that replay below.`}>
      <div className="lab-fig">
        <div className="lab-fig-h"><h3>{PLAN_NAME[plan.type]}: irrigation per year, by start year (mm/yr)</h3><Legend items={[['var(--rain)', 'Each replay'], ['var(--text-2)', 'Mean (on the card)']]} /></div>
        <LineChart xs={xs} series={[{ name: 'Irrigation', values: rows.map((r) => r.waterMm), color: 'var(--rain)' }, { name: 'Mean', values: rows.map(() => plan.metrics.waterMm), color: 'var(--text-2)', dash: true }]} height={200} xTicks={xs.filter((y) => y % 5 === 0)} tipTitle={(i) => `Started ${xs[i]} (${xs[i]}–${xs[i] + 2})`} unit=" mm" digits={0} onPick={(i) => onStartYear(xs[i])} selected={sel} label="Irrigation per replay" />
      </div>
      <div className="lab-fig">
        <div className="lab-fig-h"><h3>Income index per year, by start year</h3><Legend items={[['var(--cover)', 'Each replay']]} /></div>
        <LineChart xs={xs} series={[{ name: 'Income index', values: rows.map((r) => r.income), color: 'var(--cover)' }]} height={160} xTicks={xs.filter((y) => y % 5 === 0)} tipTitle={(i) => `Started ${xs[i]}`} digits={2} onPick={(i) => onStartYear(xs[i])} selected={sel} label="Income index per replay" />
        <p className="lab-note">{failed.length ? `A cash crop failed (yield factor under 0.6) in ${failed.length} of ${rows.length} replays: ${failed.map((r) => r.startYear).join(', ')}.` : `No cash crop failed in any of the ${rows.length} replays.`}</p>
      </div>
      <div className="lab-fig">
        <div className="lab-fig-h"><h3>Replay started in {rows[sel].startYear}</h3></div>
        <div className="lab-table"><table>
          <thead><tr><th>Slot</th><th>Crop</th><th>Grown in</th><th>Irrigation</th><th>Yield factor</th><th>Events</th></tr></thead>
          <tbody>{rows[sel].plantings.map((p) => (
            <tr key={p.slot}><td>Y{yearOf(p.slot) + 1} {seasonOf(p.slot) === 'A' ? 'spring' : 'fall'}</td><td>{cropName(p.cropId)}</td><td className="lab-mono">{p.year}</td><td className="lab-mono">{fmt(p.irrigationMm)} mm</td><td className="lab-mono">{fmt(p.yieldFactor, 2)}</td><td>{[p.frostKill && 'frost kill', p.heatDays >= 3 && `${p.heatDays} heat days`].filter(Boolean).join(', ') || '—'}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
    </Section>
  )
}

function PlantingSection({ plan, startYear, winIdx, onWin, ask, endYear }: { plan: Strategy; startYear: number; winIdx: number; onWin: (i: number) => void; ask: Ask; endYear: number }) {
  const win = plan.windows[winIdx] ?? plan.windows[0]
  const year = startYear + yearOf(win.slot)
  const season = seasonOf(win.slot)
  const crop = CROP_BY_ID[win.cropId]
  const traceKey = `${win.cropId}|${season}|${year}`
  const [answer, setAnswer] = useState<{ key: string; trace: PlantingTrace | null } | null>(null)
  useEffect(() => {
    let live = true
    ask({ kind: 'trace', cropId: win.cropId, season, year }).then((m) => { if (live && m.kind === 'trace') setAnswer({ key: traceKey, trace: m.trace }) })
    return () => { live = false }
  }, [win.cropId, season, year, traceKey, ask])
  const busy = answer?.key !== traceKey
  const trace = busy ? null : answer.trace
  const days = trace?.days ?? []
  const xs = days.map((d) => d.d)
  const st = crop.stages
  const marks = [{ x: 0, label: 'initial' }, { x: st[0], label: 'development' }, { x: st[0] + st[1], label: 'mid' }, { x: st[0] + st[1] + st[2], label: 'late' }]
  const plantDoy = crop.plant[season] ?? 1
  const tip = (i: number) => `Day ${i} · ${doyLabel(plantDoy + i, year)}`
  const sum = (k: 'etc' | 'rain' | 'irrigation' | 'erosionT') => days.reduce((a, d) => a + d[k], 0)
  const s = trace?.sim
  const dayTicks = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].filter((v) => v < (xs.length || 1))
  return (
    <Section n={8} title="Growing one planting, day by day" sub="runPlanting is a soil-water bucket: water use is Kc × ET₀, rain refills the bucket, and once depletion passes RAW (p × bucket size) a fully irrigated crop is watered back to full. Leaching for salt and irrigation efficiency are added on top. The same loop checks frost, heat, temperature fit and erosion.">
      <div className="lab-plans lab-plans--small">
        {plan.windows.map((w, i) => (
          <button type="button" key={w.slot} className={`lab-plan${i === winIdx ? ' is-on' : ''}`} onClick={() => onWin(i)} aria-pressed={i === winIdx}>
            <b>{cropName(w.cropId)}</b><span>Y{yearOf(w.slot) + 1} {seasonOf(w.slot) === 'A' ? 'spring' : 'fall'} · {startYear + yearOf(w.slot)}</span>
          </button>
        ))}
      </div>
      {year > endYear ? <p className="lab-wait">This planting falls after the weather record ends.</p> : busy ? <p className="lab-wait">Simulating…</p> : !trace || !s ? <p className="lab-wait">This crop cannot be grown in that window.</p> : (
        <>
          <div className="lab-fig">
            <div className="lab-fig-h"><h3>{crop.name}, planted {doyLabel(plantDoy, year)} {year}: soil-water depletion (mm)</h3><Legend items={[['var(--rain)', 'Depletion'], ['var(--et0)', 'RAW: water above this'], ['var(--cover)', 'Irrigation (net)']]} /></div>
            <LineChart xs={xs} series={[{ name: 'Depletion', values: days.map((d) => d.depletion), color: 'var(--rain)' }, { name: 'RAW', values: days.map((d) => d.raw), color: 'var(--et0)', dash: true }]} bars={{ name: 'Irrigation', values: days.map((d) => d.irrigation), color: 'var(--cover)' }} height={230} xTicks={dayTicks} xFmt={(v) => `day ${v}`} tipTitle={tip} unit=" mm" marks={marks} label="Daily soil-water depletion" />
          </div>
          <div className="lab-fig">
            <div className="lab-fig-h"><h3>Water demand (mm/day)</h3><Legend items={[['var(--et0)', 'ET₀ (reference grass)'], ['var(--rain)', `ETc = Kc × ET₀ (${cropName(crop.id).toLowerCase()})`]]} /></div>
            <LineChart xs={xs} series={[{ name: 'ET₀', values: days.map((d) => d.et0), color: 'var(--et0)' }, { name: 'ETc', values: days.map((d) => d.etc), color: 'var(--rain)' }]} height={170} xTicks={dayTicks} xFmt={(v) => `day ${v}`} tipTitle={tip} unit=" mm" digits={2} marks={marks} label="Daily ET0 and crop ETc" />
          </div>
          <Stats items={[
            [`${days.length} days`, `stages ${st.join(' / ')}, Kc ${crop.kc.join(' → ')}`],
            [`${fmt(sum('etc'))} mm`, 'crop water use'],
            [`${fmt(sum('rain'))} mm`, 'rain while it grew'],
            [`${days.filter((d) => d.irrigation > 0).length} × · ${fmt(sum('irrigation'))} mm`, 'irrigations · net water'],
            [`${fmt(s.irrigationGrossMm)} mm`, `gross (÷ ${DEFAULT_FIELD.irrigationEfficiency} efficiency, + ${Math.round(s.leachingFraction * 100)}% leaching)`],
            [fmt(s.yieldFactor, 2), `yield factor (salt ${fmt(s.salinityFactor, 2)}, temperature fit ${fmt(s.tempFit, 2)})`],
            [s.frostKill ? `frost ${s.frostDay}` : 'none', `frost kill · ${s.heatDays} mid-season heat days`],
            [fmt(sum('erosionT'), 3), 'erosion under the crop, t/ha'],
          ]} />
        </>
      )}
    </Section>
  )
}

function ScoringSection({ result }: { result: LabResult }) {
  const S = result.engine.strategies
  return (
    <Section n={9} title="Scoring the pool and picking the card" sub="Each criterion is turned into “higher is better”, min–max normalized to 0–100 across the whole pool, and summed with the priority weights. Small change = best plan within 2 edits that beats today’s; Best = top plan at least 3 slots away keeping half the income; Another way = next top plan at least 4 slots from the others.">
      <div className="lab-fig">
        <div className="lab-fig-h"><h3>All {fmt(result.pool.points.length / 4)} scored rotations: irrigation vs income</h3><Legend items={[['var(--q1)', 'Low total score'], ['var(--q3)', ''], ['var(--q5)', 'High']]} /></div>
        <PoolScatter points={result.pool.points} highlights={S.map((s) => ({ water: s.metrics.waterMm, income: s.metrics.income, label: PLAN_NAME[s.type] }))} label="Every scored rotation by irrigation and income" />
      </div>
      <div className="lab-fig">
        <div className="lab-fig-h"><h3>The card’s plans: criterion scores (0–100) and weights</h3></div>
        <div className="lab-table"><table>
          <thead><tr><th>Plan</th>{PRIORITY_KEYS.map((k) => <th key={k} title={PRIORITY_LABELS[k]}>{k}<br /><span className="lab-note">×{DEFAULT_PRIORITIES[k]}</span></th>)}<th>Total</th></tr></thead>
          <tbody>{S.map((s) => (
            <tr key={s.type}><td><b>{PLAN_NAME[s.type]}</b><br /><span className="lab-note">{s.rotation.label}</span></td>{PRIORITY_KEYS.map((k) => <td key={k} className="lab-mono">{fmt(s.scores[k])}</td>)}<td className="lab-mono"><b>{fmt(s.total, 1)}</b></td></tr>
          ))}</tbody>
        </table></div>
      </div>
      <div className="lab-cards">
        {S.map((s) => (
          <div key={s.type} className="lab-card">
            <span className="lab-eyebrow">{PLAN_NAME[s.type]}{s.rank ? ` · rank ${fmt(s.rank)} of ${fmt(result.engine.poolSize)}` : ''}</span>
            <b>{s.card.headline}</b>
            <ul>{s.card.why.slice(0, 3).map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        ))}
      </div>
    </Section>
  )
}

function Legend({ items }: { items: [string, string][] }) {
  return <div className="lab-legend">{items.map(([c, n], i) => <span key={i}><i className="lab-sw" style={{ background: c }} />{n}</span>)}</div>
}

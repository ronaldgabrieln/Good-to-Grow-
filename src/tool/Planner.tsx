import { useCallback, useEffect, useRef, useState } from 'react'
import { ANALYSIS_START_YEAR, DEFAULT_FIELD, loadFieldData, type FieldData, type FieldInput, type LoadStep } from '../engine'
import DecisionTool from './DecisionTool'
import { findFrames, type Frame } from './landsatFrames'
import { LoadingScreen } from './LoadingScreen'
import { MapPicker, type PickedPoint } from './MapPicker'
import './flow.css'

type Stage = 'pick' | 'analyzing' | 'results'

const STEP_TEXT: Record<LoadStep | 'engine' | 'start', string> = {
  start: 'Getting ready…',
  weather: 'Reading 30 years of NASA POWER weather for your field…',
  soil: 'Reading your soil (SoilGrids)…',
  engine: 'Replaying thousands of rotations against your weather…',
}
/** Progress the bar creeps toward during each step (it never fakes completion). */
const STEP_TARGET: Record<LoadStep | 'engine' | 'start', number> = { start: 0.08, weather: 0.55, soil: 0.7, engine: 0.95 }

const MIN_LOADING_MS = 4500 // lets the letters finish their entrance

function fieldFor(p: PickedPoint): FieldInput {
  const nearManeadero = Math.abs(p.lat - DEFAULT_FIELD.lat) < 0.12 && Math.abs(p.lon - DEFAULT_FIELD.lon) < 0.12
  return { ...DEFAULT_FIELD, lat: p.lat, lon: p.lon, name: nearManeadero ? DEFAULT_FIELD.name : 'My field' }
}

export default function Planner({ onHome }: { onHome?: () => void }) {
  const [stage, setStage] = useState<Stage>('pick')
  const [picked, setPicked] = useState<PickedPoint | null>(null)
  const [field, setField] = useState<FieldInput>(DEFAULT_FIELD)
  const [data, setData] = useState<FieldData | null>(null)
  const [frames, setFrames] = useState<Frame[]>([])
  const [missingYears, setMissingYears] = useState<number[]>([])
  const [playFraction, setPlayFraction] = useState(0)
  const [playComplete, setPlayComplete] = useState(false)
  const [step, setStep] = useState<keyof typeof STEP_TEXT>('start')
  const [progress, setProgress] = useState(0)
  const [engineReady, setEngineReady] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const urlsRef = useRef<string[]>([])

  const releaseFrames = () => {
    abortRef.current?.abort()
    urlsRef.current.forEach((u) => URL.revokeObjectURL(u))
    urlsRef.current = []
  }
  useEffect(() => releaseFrames, [])

  const analyze = useCallback(() => {
    if (!picked) return
    releaseFrames()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const f = fieldFor(picked)
    setField(f)
    setData(null)
    setFrames([])
    setMissingYears([])
    setPlayFraction(0)
    setPlayComplete(false)
    setEngineReady(false)
    setError(null)
    setProgress(0.02)
    setStep('start')
    setStartedAt(performance.now())
    setStage('analyzing')

    findFrames(f.lat, f.lon, {
      fromYear: ANALYSIS_START_YEAR,
      signal: ctrl.signal,
      onMissing: (y) => setMissingYears((prev) => (prev.includes(y) ? prev : [...prev, y])),
      onFrame: (fr) => {
        urlsRef.current.push(fr.url)
        setFrames((prev) => [...prev, fr])
      },
    }).catch(() => {})

    loadFieldData(f.lat, f.lon, { onStep: (s) => setStep(s) })
      .then((d) => {
        if (ctrl.signal.aborted) return
        setData(d)
        setStep('engine')
      })
      .catch((e: Error) => setError(e.message))
  }, [picked])

  // The loading screen ends only when the analysis is ready AND the timelapse has played every
  // retrievable year once, in order. No time cap: the farmer always sees the whole history.
  const totalYears = new Date().getUTCFullYear() - ANALYSIS_START_YEAR + 1
  // Belt and braces: every year must be settled (shown-able or confirmed missing) before "Done".
  const allYearsSettled = new Set([...frames.map((f) => f.year), ...missingYears]).size >= totalYears
  const finished = engineReady && playComplete && allYearsSettled && now - startedAt >= MIN_LOADING_MS
  // Bar = half analysis (creeping toward each step's target), half timelapse playback.
  useEffect(() => {
    if (stage !== 'analyzing') return
    const t = setInterval(() => {
      setNow(performance.now())
      setProgress((p) => {
        const target = engineReady ? 1 : STEP_TARGET[step]
        return p + (target - p) * (engineReady ? 0.35 : 0.06)
      })
    }, 100)
    return () => clearInterval(t)
  }, [stage, step, engineReady])
  const shownProgress = 0.5 * progress + 0.5 * playFraction
  const onPlayback = useCallback((fraction: number, complete: boolean) => {
    setPlayFraction(fraction)
    if (complete) setPlayComplete(true)
  }, [])

  const onFirstResult = useCallback(() => setEngineReady(true), [])
  const onExited = useCallback(() => setStage('results'), [])
  const changeLocation = useCallback(() => {
    abortRef.current?.abort()
    setStage('pick')
  }, [])

  return (
    <>
      {stage === 'pick' && (
        <MapPicker
          initialCenter={picked ?? { lat: DEFAULT_FIELD.lat, lon: DEFAULT_FIELD.lon }}
          initialZoom={picked ? 15 : 13}
          picked={picked}
          onPick={setPicked}
          onAnalyze={analyze}
          onHome={onHome}
        />
      )}
      {stage !== 'pick' && data && (
        <DecisionTool
          key={`${field.lat},${field.lon}`}
          data={data}
          initialField={field}
          frames={frames}
          onChangeLocation={changeLocation}
          onFirstResult={onFirstResult}
          onHome={onHome}
        />
      )}
      {stage === 'analyzing' && (
        <LoadingScreen
          lat={field.lat}
          lon={field.lon}
          frames={frames}
          missingYears={missingYears}
          years={[ANALYSIS_START_YEAR, new Date().getUTCFullYear()]}
          progress={shownProgress}
          step={
            error
              ? `Something went wrong: ${error}`
              : finished
                ? 'Done'
                : engineReady
                  ? `Rotations ready. Showing your field year by year (${frames.length} images found, ${frames.length + missingYears.length} of ${totalYears} years checked)…`
                  : STEP_TEXT[step]
          }
          done={finished}
          onExited={onExited}
          onPlayback={onPlayback}
        />
      )}
    </>
  )
}

import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_CURRENT,
  DEFAULT_PRIORITIES,
  DEFAULT_SCENARIO,
  SOURCES,
  checkRotation,
  type EngineInput,
  type FieldData,
  type FieldInput,
  type Priorities,
  type PriorityKey,
  type Scenario,
  type Slots,
} from '../engine'
import { BrandLogo, HomeButton } from './Brand'
import { ClimatePanel } from './ClimatePanel'
import { ComparisonTable } from './ComparisonTable'
import { FieldPanel, PriorityPanel, RotationEditor, ScenarioPanel } from './Controls'
import { FieldFromSpace } from './FieldFromSpace'
import { fmt } from './format'
import type { Frame } from './landsatFrames'
import { RotationCalendar } from './RotationCalendar'
import { StrategyCardView } from './StrategyCardView'
import { useEngine } from './useEngine'
import './tool.css'

export default function DecisionTool(props: {
  data: FieldData
  initialField: FieldInput
  frames: Frame[]
  onChangeLocation: () => void
  /** Fires once, when the first engine result is ready (the loading screen waits for it). */
  onFirstResult?: () => void
  onHome?: () => void
}) {
  const { data, frames, onChangeLocation, onFirstResult } = props
  const [field, setField] = useState<FieldInput>(props.initialField)
  const [current, setCurrent] = useState<Slots>(DEFAULT_CURRENT)
  const [priorities, setPriorities] = useState<Priorities>(DEFAULT_PRIORITIES)
  const [scenario, setScenario] = useState<Scenario>(DEFAULT_SCENARIO)

  const input = useMemo<EngineInput>(() => ({ data, field, scenario, priorities, current }), [data, field, scenario, priorities, current])
  const { result, running, error } = useEngine(input)
  const hasResult = result !== null
  useEffect(() => {
    if (hasResult) onFirstResult?.()
  }, [hasResult, onFirstResult])

  const problems = useMemo(() => checkRotation(current).reasons, [current])
  const weights = useMemo(() => {
    const sum = Object.values(priorities).reduce((a, b) => a + b, 0) || 1
    return Object.fromEntries(Object.entries(priorities).map(([k, v]) => [k, v / sum])) as Record<PriorityKey, number>
  }, [priorities])

  return (
    <div className="tool">
      <header className="tool-bar">
        <div className="tool-brand">
          <BrandLogo />
          <div>
            <h1>Rotation planner</h1>
            <span className="muted small">{field.name}</span>
          </div>
        </div>
        <div className="run-state" aria-live="polite">
          {error ? (
            <span className="error">Engine error: {error}</span>
          ) : running || !result ? (
            <span>Replaying rotations against your weather history…</span>
          ) : (
            <span>
              {fmt(result.poolSize)} rotations replayed against {result.features.nYears} years in {fmt(result.elapsedMs)} ms
            </span>
          )}
        </div>
        <HomeButton onHome={props.onHome} />
      </header>

      <div className="tool-body">
        <aside className="controls">
          <FieldPanel field={field} onChange={setField} onChangeLocation={onChangeLocation} status={data.notes} />
          <RotationEditor slots={current} onChange={setCurrent} problems={problems} />
          <PriorityPanel priorities={priorities} onChange={setPriorities} />
          <ScenarioPanel scenario={scenario} onChange={setScenario} />
        </aside>

        <main className={`results ${running ? 'is-stale' : ''}`}>
          {!result ? (
            <div className="card empty">Replaying rotations against your weather history…</div>
          ) : (
            <>
              <ClimatePanel result={result} />
              <FieldFromSpace frames={frames} />
              <RotationCalendar strategies={result.strategies} features={result.features} />
              <ComparisonTable strategies={result.strategies} weights={weights} />
              <section className="strategies">
                {result.strategies.map((s, i) => (
                  <StrategyCardView key={s.rotation.id + i} s={s} />
                ))}
              </section>
              <section className="card method">
                <h2>How the suggestions are made</h2>
                <ol>
                  <li>30 years of daily NASA POWER weather for your point are turned into crop water demand (FAO-56 Penman–Monteith), frost, heat and rainfall-erosivity numbers.</li>
                  <li>Each crop is grown day by day in every historical year with a soil-water balance using your soil (SoilGrids), well salinity and irrigation system.</li>
                  <li>Thousands of 3-year rotations are generated under the rules below and replayed through every start year. The result is how often things went right or wrong, not a single guess.</li>
                  <li>Each rotation is scored on seven goals and ranked by your priority sliders. Cards explain every suggestion with the numbers behind it.</li>
                </ol>
                <h3>Agronomic rules</h3>
                <ul>
                  {result.rules.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <h3>Sources</h3>
                <ul className="small">
                  {Object.values(SOURCES).map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                  <li>NASA/USGS Landsat Collection 2 (Landsat 5, 8, 9; 30 m) via Microsoft Planetary Computer: field images by year</li>
                  <li>Map imagery © Esri, Maxar, Earthstar Geographics</li>
                </ul>
                <p className="small muted">
                  This tool supports, and does not replace, the judgment of farmers and local agronomists. Numbers are modeled from coarse global datasets.
                </p>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_PRIORITIES,
  DEFAULT_SCENARIO,
  SOURCES,
  checkRotation,
  type EngineInput,
  type FieldData,
  type FieldInput,
  type Priorities,
  type PriorityKey,
  type RotationMetrics,
  type Scenario,
  type Slots,
  type Strategy,
  type StrategyType,
} from '../engine'
import type { AgentContext } from '../agent/toolHandlers'
import { AgentPanel } from './AgentPanel'
import { BrandLogo, HomeButton } from './Brand'
import { ClimatePanel } from './ClimatePanel'
import { ComparisonTable } from './ComparisonTable'
import { FieldPanel, PriorityPanel, RotationEditor, ScenarioPanel } from './Controls'
import { FieldFromSpace } from './FieldFromSpace'
import { fmt } from './format'
import type { Frame } from './landsatFrames'
import { RotationCalendar } from './RotationCalendar'
import { RotationRing } from './RotationRing'
import { StrategyCardView } from './StrategyCardView'
import { Terrain3D, type TerrainLayer } from './terrain/Terrain3D'
import type { Terrain } from './terrain/terrain'
import { useEngine } from './useEngine'
import { useEvaluator } from './useEvaluator'
import './tool.css'
import changeFieldImg from '../assets/Hello (9).svg'

/** Plain names a farmer understands. */
const PLAIN_TITLE: Record<StrategyType, string> = {
  current: 'What you do now',
  'small-change': 'A small change',
  best: 'Best for you',
  different: 'Another way',
}

const GOALS: { key: string; label: string; priorities: Priorities }[] = [
  { key: 'balanced', label: 'A bit of everything', priorities: DEFAULT_PRIORITIES },
  { key: 'water', label: 'Save water', priorities: { water: 5, income: 3, soil: 2, nitrogen: 2, erosion: 2, pest: 2, risk: 2 } },
  { key: 'income', label: 'Earn more', priorities: { water: 2, income: 5, soil: 1, nitrogen: 2, erosion: 1, pest: 3, risk: 4 } },
  { key: 'soil', label: 'Healthier soil', priorities: { water: 2, income: 3, soil: 5, nitrogen: 3, erosion: 5, pest: 3, risk: 2 } },
]

const pct = (a: number, b: number) => (b === 0 ? 0 : ((a - b) / Math.abs(b)) * 100)

interface Stat {
  label: string
  text: string
  tone: 'good' | 'bad' | 'same'
}

function plainStats(m: RotationMetrics, base: RotationMetrics | null): Stat[] {
  if (!base) {
    return [
      { label: 'Water', text: `${fmt(m.waterMm * 10)} m³ per hectare a year`, tone: 'same' },
      { label: 'Money', text: `Income score ${fmt(m.income, 1)}`, tone: 'same' },
      { label: 'Soil', text: `${fmt(m.erosionT, 1)} t/ha of soil lost a year`, tone: 'same' },
    ]
  }
  const w = pct(m.waterMm, base.waterMm)
  const inc = pct(m.income, base.income)
  const ero = pct(m.erosionT, base.erosionT)
  const carb = pct(m.soilCarbon, base.soilCarbon)
  const soilGood = (ero <= -5 ? 1 : ero >= 5 ? -1 : 0) + (carb >= 5 ? 1 : carb <= -5 ? -1 : 0)
  return [
    {
      label: 'Water',
      text: Math.abs(w) < 3 ? 'About the same water' : `Uses ${fmt(Math.abs(w))}% ${w < 0 ? 'less' : 'more'} water`,
      tone: Math.abs(w) < 3 ? 'same' : w < 0 ? 'good' : 'bad',
    },
    {
      label: 'Money',
      text: Math.abs(inc) < 3 ? 'About the same income' : `Earns about ${fmt(Math.abs(inc))}% ${inc > 0 ? 'more' : 'less'}`,
      tone: Math.abs(inc) < 3 ? 'same' : inc > 0 ? 'good' : 'bad',
    },
    {
      label: 'Soil',
      text: soilGood > 0 ? 'Protects the soil better' : soilGood < 0 ? 'Harder on the soil' : 'About the same for the soil',
      tone: soilGood > 0 ? 'good' : soilGood < 0 ? 'bad' : 'same',
    },
  ]
}

/** Hand-drawn little glyphs for the option tiles (stroke only, drawn in white on the tile). */
function TileIcon({ type }: { type: StrategyType }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 3.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <svg viewBox="0 0 48 48" aria-hidden width="100%" height="100%">
      {type === 'current' && (
        <g {...common}>
          <path d="M6 34c10-6 26-6 36 0" />
          <path d="M6 25c10-6 26-6 36 0" />
          <path d="M6 16c10-6 26-6 36 0" />
        </g>
      )}
      {type === 'small-change' && (
        <g {...common}>
          <path d="M24 40V22" />
          <path d="M24 26c-8 0-12-5-12-11 8 0 12 4 12 11z" />
          <path d="M24 22c0-6 4-10 12-10 0 6-4 10-12 10z" />
          <path d="M10 41h28" />
        </g>
      )}
      {type === 'best' && <path {...common} d="M24 6l5.4 11.2 12.2 1.6-8.9 8.5 2.2 12.1L24 33.5l-10.9 5.9 2.2-12.1-8.9-8.5 12.2-1.6z" />}
      {type === 'different' && (
        <g {...common}>
          <path d="M9 18h20l-5-6M9 18l5 6" />
          <path d="M39 30H19l5 6M39 30l-5-6" />
        </g>
      )}
    </svg>
  )
}

/** The big top half of the card: what the picked option is, and why. */
function OptionHero(props: { s: Strategy; base: RotationMetrics | null; current?: Slots }) {
  const { s } = props
  const isCurrent = s.type === 'current'
  const stats = isCurrent ? [] : plainStats(s.metrics, props.base)
  // One plain reason: the mechanism sentence (cover crops / legumes) if there is one.
  const reason =
    s.card.why.find((w) => /protect|fixes|fix nitrogen/.test(w)) ??
    (isCurrent ? 'This is what you told us you plant now.' : s.card.why.find((w) => /Smallest step|different approach/.test(w)))
  return (
    <div className={`choice-hero hero-${s.type}`} key={s.type} aria-live="polite">
      <div className="hero-top">
        <span className="hero-pill hero-pill--title">{PLAIN_TITLE[s.type]}</span>
        <span className="hero-pill">Shown on the land</span>
      </div>
      <RotationRing slots={s.rotation.slots} current={isCurrent ? undefined : props.current} />
      {stats.length > 0 && (
        <ul className="hero-stats">
          {stats.map((st) => (
            <li key={st.label} className={`tone-${st.tone}`}>
              <span className="stat-icon" aria-hidden>
                {st.tone === 'good' ? '▲' : st.tone === 'bad' ? '▼' : '•'}
              </span>
              <span className="stat-label">{st.label}</span>
              {st.text}
            </li>
          ))}
        </ul>
      )}
      {reason && <p className="hero-reason">{reason}</p>}
      {/* "Talk to your extension agent" note hidden for now; the text is still in s.card.extension */}
    </div>
  )
}

function OptionTile(props: { s: Strategy; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`choice-tile choice-tile-${props.s.type} ${props.selected ? 'is-on' : ''}`} aria-pressed={props.selected} onClick={props.onSelect}>
      <span className="choice-tile-icon">
        <TileIcon type={props.s.type} />
      </span>
      <span className="choice-tile-label">{PLAIN_TITLE[props.s.type]}</span>
    </button>
  )
}

export default function DecisionTool(props: {
  data: FieldData
  initialField: FieldInput
  initialCurrent: Slots
  initialPriorities?: Priorities
  terrain: Terrain | null
  terrainError: string | null
  frames: Frame[]
  onChangeLocation: () => void
  /** Fires once, when the first engine result is ready (the loading screen waits for it). */
  onFirstResult?: () => void
  onHome?: () => void
}) {
  const { data, frames, onChangeLocation, onFirstResult, terrain } = props
  const [field, setField] = useState<FieldInput>(props.initialField)
  const [current, setCurrent] = useState<Slots>(props.initialCurrent)
  const [priorities, setPriorities] = useState<Priorities>(props.initialPriorities ?? DEFAULT_PRIORITIES)
  const [scenario, setScenario] = useState<Scenario>(DEFAULT_SCENARIO)
  const [selectedType, setSelectedType] = useState<StrategyType>('best')
  const [layer, setLayer] = useState<TerrainLayer>('erosion')
  const [showDetails, setShowDetails] = useState(false)
  const detailsRef = useRef<HTMLDivElement>(null)

  // Slope and elevation at the field come from the SRTM terrain once it has loaded.
  const syncedTerrain = useRef<Terrain | null>(null)
  useEffect(() => {
    if (!terrain || syncedTerrain.current === terrain) return
    syncedTerrain.current = terrain
    setField((f) => ({
      ...f,
      slopePct: Math.round(terrain.field.slopePct * 10) / 10,
      elevationM: Math.round(terrain.field.elevationM),
    }))
  }, [terrain])

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
  const goal = GOALS.find((g) => JSON.stringify(g.priorities) === JSON.stringify(priorities))?.key ?? 'custom'

  const strategies = result?.strategies ?? []
  const base = strategies.find((s) => s.type === 'current')?.metrics ?? null
  const selected = strategies.find((s) => s.type === selectedType) ?? strategies.find((s) => s.type !== 'current') ?? strategies[0]

  // The planning agent reads the latest results through this ref (tools run against the engine).
  const evaluate = useEvaluator()
  const agentContext = useRef<AgentContext | null>(null)
  useEffect(() => {
    agentContext.current = result
      ? {
          result,
          input,
          evaluate,
          showOnLand: (option, layerKey) => {
            if (!result.strategies.some((s) => s.type === option)) return `The option "${option}" is not on screen right now.`
            setSelectedType(option)
            setLayer(layerKey)
            return terrain ? null : 'The 3D view is still loading; the option is selected and will show when it is ready.'
          },
        }
      : null
  }, [result, input, evaluate, terrain])
  const getAgentContext = useCallback(() => agentContext.current, [])

  const openDetails = () => {
    setShowDetails(true)
    requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return (
    <div className="tool">
      <header className="tool-bar">
        <div className="tool-brand">
          <BrandLogo />
          <div>
            <h1>Your farm</h1>
            <span className="muted small">{field.name}</span>
          </div>
        </div>
        {/* paper button, styled like the "back" one next to it (.home-btn) */}
        <button type="button" className="home-btn bar-change" onClick={onChangeLocation}>
          <img src={changeFieldImg} alt="Change field" />
        </button>
        <HomeButton onHome={props.onHome} />
      </header>

      {!result ? (
        <div className="simple-wait">{error ? `Engine error: ${error}` : 'Replaying rotations against your weather history…'}</div>
      ) : (
        <div className="simple">
          <section className="simple-land" aria-label="3D view of your land">
            <div className="layer-chips" role="radiogroup" aria-label="What to show on the land">
              {(
                [
                  ['erosion', 'Soil washing away'],
                  ['water', 'Where water runs'],
                  ['satellite', 'Just the photo'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={layer === k} className={layer === k ? 'is-on' : ''} onClick={() => setLayer(k)}>
                  {label}
                </button>
              ))}
            </div>
            {terrain && selected ? (
              <Terrain3D
                terrain={terrain}
                layer={layer}
                erosionAtField={selected.metrics.erosionT}
                rotationLabel={PLAIN_TITLE[selected.type].toLowerCase()}
              />
            ) : (
              <div className="terrain-wait">
                {props.terrainError ? `The 3D view could not load (${props.terrainError}).` : 'Building the 3D view of your land from NASA SRTM elevation…'}
              </div>
            )}
          </section>

          <section className="simple-choices" aria-label="What to plant next">
            <h2>What should you plant next?</h2>
            <div className="goal-chips" role="radiogroup" aria-label="What matters most to you">
              <span className="goal-q">What matters most to you?</span>
              {GOALS.map((g) => (
                <button key={g.key} type="button" role="radio" aria-checked={goal === g.key} className={goal === g.key ? 'is-on' : ''} onClick={() => setPriorities(g.priorities)}>
                  {g.label}
                </button>
              ))}
            </div>
            {selected && (
              <div className={`choice-card ${running ? 'is-stale' : ''}`}>
                <OptionHero s={selected} base={base} current={current} />
                <div className="choice-tiles" role="group" aria-label="Pick a way to plant">
                  {strategies.map((s) => (
                    <OptionTile key={s.type} s={s} selected={selected === s} onSelect={() => setSelectedType(s.type)} />
                  ))}
                </div>
              </div>
            )}
            <button type="button" className="btn details-btn" onClick={() => (showDetails ? setShowDetails(false) : openDetails())} aria-expanded={showDetails}>
              {showDetails ? 'Hide the details' : 'See all the details'}
            </button>
            <p className="small muted simple-foot">
              Based on {result.features.nYears} years of NASA weather for your field. A guide to talk over with your agronomist, not a rule.
            </p>
          </section>
        </div>
      )}

      {result && <AgentPanel getContext={getAgentContext} />}

      {result && showDetails && (
        <div className="tool-body details" ref={detailsRef}>
          <aside className="controls">
            <FieldPanel field={field} onChange={setField} onChangeLocation={onChangeLocation} status={data.notes} />
            <RotationEditor slots={current} onChange={setCurrent} problems={problems} />
            <PriorityPanel priorities={priorities} onChange={setPriorities} />
            <ScenarioPanel scenario={scenario} onChange={setScenario} />
          </aside>

          <main className={`results ${running ? 'is-stale' : ''}`}>
            <p className="small muted run-line">
              {fmt(result.poolSize)} rotations replayed against {result.features.nYears} years in {fmt(result.elapsedMs)} ms
              {terrain ? ` · slope ${fmt(field.slopePct, 1)}% and elevation ${fmt(field.elevationM)} m from NASA SRTM` : ''}
            </p>
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
                <li>Each rotation is scored on seven goals and ranked by your priorities. Cards explain every suggestion with the numbers behind it.</li>
                <li>The 3D view uses NASA SRTM elevation: soil loss at your field is spread over the land by slope (RUSLE LS factor), and water paths come from a D8 flow model.</li>
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
                <li>NASA SRTM elevation via AWS Terrain Tiles: 3D land, slope and water paths</li>
                <li>Map and 3D imagery © Esri, Maxar, Earthstar Geographics</li>
              </ul>
              <p className="small muted">
                This tool supports, and does not replace, the judgment of farmers and local agronomists. Numbers are modeled from coarse global datasets.
              </p>
            </section>
          </main>
        </div>
      )}
    </div>
  )
}

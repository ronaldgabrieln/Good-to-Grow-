import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  CROP_BY_ID,
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
  type SlotEvaluation,
  type Slots,
} from '../engine'
import type { PlanKey } from '../agent/toolDefs'
import type { AgentContext, YourPlan } from '../agent/toolHandlers'
import { useProfile } from '../profile/ProfileContext'
import { ProfileButton, ProfilePanel } from '../profile/ProfilePanel'
import { PlanSaveBar } from '../profile/PlanSaveBar'
import { buildPayload } from '../profile/snapshot'
import type { SavedStrategy } from '../profile/types'
import { AgentPanel, type AgentRequest } from './AgentPanel'
import { BrandLogo, HomeButton } from './Brand'
import { ClimatePanel } from './ClimatePanel'
import { ComparisonTable } from './ComparisonTable'
import { FieldPanel, PriorityPanel, RotationEditor, ScenarioPanel } from './Controls'
import { FieldFromSpace } from './FieldFromSpace'
import { NODE_SITE } from '../engine/ground'
import { FieldEvidence } from './FieldEvidence'
import { GroundStrip } from './GroundStrip'
import { LiveFeed } from './LiveFeed'
import { useGround } from './useGround'
import { fmt } from './format'
import type { Frame } from './landsatFrames'
import { PLAIN_TITLE, plainStats } from './plans'
import { RotationCalendar } from './RotationCalendar'
import { RotationRing } from './RotationRing'
import { StrategyCardView } from './StrategyCardView'
import { Terrain3D, type TerrainLayer } from './terrain/Terrain3D'
import type { Terrain } from './terrain/terrain'
import { useEngine } from './useEngine'
import { useEvaluator } from './useEvaluator'
import './tool.css'
import changeFieldImg from '../assets/change_field.svg'
import iconBalanced from '../assets/a_bit_of_everything.svg'
import iconWater from '../assets/save_water.svg'
import iconIncome from '../assets/earn_more.svg'
import iconSoil from '../assets/healthier_soil.svg'
import iconCurrent from '../assets/what_you_do_now.svg'
import iconBest from '../assets/best_for_you.svg'
import iconDifferent from '../assets/another_way.svg'

type GoalKey = 'balanced' | 'water' | 'income' | 'soil'
const GOALS: { key: GoalKey; label: string; priorities: Priorities }[] = [
  { key: 'balanced', label: 'A bit of everything', priorities: DEFAULT_PRIORITIES },
  { key: 'water', label: 'Save water', priorities: { water: 5, income: 3, soil: 2, nitrogen: 2, erosion: 2, pest: 2, risk: 2 } },
  { key: 'income', label: 'Earn more', priorities: { water: 2, income: 5, soil: 1, nitrogen: 2, erosion: 1, pest: 3, risk: 4 } },
  { key: 'soil', label: 'Healthier soil', priorities: { water: 2, income: 3, soil: 5, nitrogen: 3, erosion: 5, pest: 3, risk: 2 } },
]

const SEASON_NAMES = ['Year 1 spring', 'Year 1 fall', 'Year 2 spring', 'Year 2 fall', 'Year 3 spring', 'Year 3 fall']

/** Everything the card needs about one plan, whether it came from the engine or from the farmer's edits. */
interface PlanView {
  key: PlanKey
  slots: Slots
  metrics: RotationMetrics | null
  reason: string | null
  problems: string[]
  /** "yours" only: the option it was edited from, and which seasons changed. */
  fromTitle?: string
  edits?: string[]
}

/**
 * Hand-drawn sticker icons for the tiles (src/assets, named after each tile).
 * The drawings are not centered inside their SVGs, so each one carries where its drawing sits
 * (measured from the file): canvas w/h, drawing center cx/cy and drawing size fw/fh as fractions.
 */
type Sticker = { src: string; w: number; h: number; cx: number; cy: number; fw: number; fh: number }
const TILE_STICKERS: Partial<Record<PlanKey | GoalKey, Sticker>> = {
  balanced: { src: iconBalanced, w: 495, h: 591, cx: 0.54, cy: 0.581, fw: 0.77, fh: 0.66 },
  water: { src: iconWater, w: 354, h: 456, cx: 0.532, cy: 0.52, fw: 0.57, fh: 0.71 },
  income: { src: iconIncome, w: 432, h: 456, cx: 0.543, cy: 0.59, fw: 0.67, fh: 0.82 },
  soil: { src: iconSoil, w: 522, h: 519, cx: 0.443, cy: 0.546, fw: 0.88, fh: 0.81 },
  // "A small change" has no sticker of its own: it shares the sprout with "Healthier soil".
  'small-change': { src: iconSoil, w: 522, h: 519, cx: 0.443, cy: 0.546, fw: 0.88, fh: 0.81 },
  current: { src: iconCurrent, w: 537, h: 474, cx: 0.52, cy: 0.489, fw: 0.75, fh: 0.58 },
  best: { src: iconBest, w: 435, h: 414, cx: 0.517, cy: 0.473, fw: 0.71, fh: 0.77 },
  different: { src: iconDifferent, w: 543, h: 495, cx: 0.494, cy: 0.507, fw: 0.63, fh: 0.75 },
}

/** Places a sticker so its drawing (not its canvas) fills and is centered in the square. */
function stickerStyle(s: Sticker): CSSProperties {
  const aspect = (s.fw * s.w) / (s.fh * s.h) // drawing width / height
  const drawW = aspect >= 1 ? 1 : aspect // drawing size as a fraction of the square
  const imgW = drawW / s.fw
  const imgH = (imgW * s.h) / s.w
  return {
    width: `${imgW * 100}%`,
    height: `${imgH * 100}%`,
    left: `${(0.5 - s.cx * imgW) * 100}%`,
    top: `${(0.5 - s.cy * imgH) * 100}%`,
  }
}

/** Tiles without a sticker yet keep a little glyph, drawn in white on a colored square. */
function TileIcon({ type }: { type: PlanKey | GoalKey }) {
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
      {type === 'yours' && (
        <g {...common}>
          <path d="M31 9l8 8-20 20-10 2 2-10z" />
          <path d="M27 13l8 8" />
        </g>
      )}
      {type === 'balanced' && (
        <g {...common}>
          <path d="M24 8v32M14 40h20M10 14h28" />
          <path d="M10 14l-5 12h10zM38 14l-5 12h10z" />
        </g>
      )}
      {type === 'water' && <path {...common} d="M24 6c8 11 13 18 13 24a13 13 0 0 1-26 0c0-6 5-13 13-24z" />}
      {type === 'income' && (
        <g {...common}>
          <ellipse cx="24" cy="14" rx="13" ry="5" />
          <path d="M11 14v8c0 2.8 5.8 5 13 5s13-2.2 13-5v-8" />
          <path d="M11 22v8c0 2.8 5.8 5 13 5s13-2.2 13-5v-8" />
        </g>
      )}
      {type === 'soil' && (
        <g {...common}>
          <path d="M6 40h36M10 33h28" />
          <path d="M24 33V20" />
          <path d="M24 23c-7 0-10-4-10-10 7 0 10 4 10 10zM24 20c0-5 3-9 10-9 0 5-3 9-10 9z" />
        </g>
      )}
    </svg>
  )
}

/** The big middle of the card: what the picked plan is, and why. */
function OptionHero(props: { plan: PlanView; base: RotationMetrics | null; current?: Slots; onReview: () => void; onUndo?: () => void; extra?: ReactNode }) {
  const { plan } = props
  const isCurrent = plan.key === 'current'
  const stats = isCurrent || !plan.metrics ? [] : plainStats(plan.metrics, props.base)
  return (
    <div className={`choice-hero hero-${plan.key}`} key={plan.key} aria-live="polite">
      <div className="hero-top">
        <span className="hero-pill hero-pill--title">{PLAIN_TITLE[plan.key]}</span>
        <span className="hero-pill">{plan.fromTitle ? `Edited from ${plan.fromTitle}` : 'Shown on the land'}</span>
      </div>
      <RotationRing slots={plan.slots} current={isCurrent ? undefined : props.current} />
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
      {plan.edits && plan.edits.length > 0 && <p className="hero-reason">You changed: {plan.edits.join('; ')}.</p>}
      {plan.reason && <p className="hero-reason">{plan.reason}</p>}
      {plan.problems.length > 0 && <p className="hero-warn">⚠ {plan.problems.join(' ')}</p>}
      <div className="hero-actions">
        <button type="button" className="btn hero-review" onClick={props.onReview}>
          Review this plan with the helper
        </button>
        {props.onUndo && (
          <button type="button" className="agent-link" onClick={props.onUndo}>
            Undo my changes
          </button>
        )}
        {props.extra}
      </div>
    </div>
  )
}

function Tile(props: { kind: PlanKey | GoalKey; label: string; selected: boolean; onSelect: () => void; radio?: boolean }) {
  const sticker = TILE_STICKERS[props.kind]
  return (
    <button
      type="button"
      className={`choice-tile choice-tile-${props.kind} ${props.selected ? 'is-on' : ''}`}
      role={props.radio ? 'radio' : undefined}
      aria-pressed={props.radio ? undefined : props.selected}
      aria-checked={props.radio ? props.selected : undefined}
      onClick={props.onSelect}
    >
      {sticker ? (
        <span className="choice-tile-icon is-sticker">
          <span className="sticker-box">
            <img src={sticker.src} alt="" style={stickerStyle(sticker)} />
          </span>
        </span>
      ) : (
        <span className="choice-tile-icon">
          <TileIcon type={props.kind} />
        </span>
      )}
      <span className="choice-tile-label">{props.label}</span>
    </button>
  )
}

export default function DecisionTool(props: {
  data: FieldData
  initialField: FieldInput
  initialCurrent: Slots
  initialPriorities?: Priorities
  /** When reopening a saved plan: its climate test, which plan was open, and the farmer's edited plan. */
  initialScenario?: Scenario
  initialSelected?: PlanKey
  initialYours?: YourPlan | null
  /** Reopen a saved plan (location, crops, priorities): handled by the planner. */
  onOpenSaved?: (s: SavedStrategy) => void
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
  const [scenario, setScenario] = useState<Scenario>(props.initialScenario ?? DEFAULT_SCENARIO)
  const [selectedKey, setSelectedKey] = useState<PlanKey>(props.initialSelected ?? 'best')
  /** The farmer's own plan, made by allowing a change the helper proposed. */
  const [yours, setYours] = useState<YourPlan | null>(props.initialYours ?? null)
  const [yoursEval, setYoursEval] = useState<{ plan: YourPlan; input: EngineInput; ev: SlotEvaluation } | null>(null)
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentRequest, setAgentRequest] = useState<AgentRequest | null>(null)
  const [layer, setLayer] = useState<TerrainLayer>('erosion')
  const [showDetails, setShowDetails] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const detailsRef = useRef<HTMLDivElement>(null)
  const farm = useProfile()

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
  const evaluate = useEvaluator()

  // "Your plan" is replayed again whenever the field, weather scenario or priorities change.
  useEffect(() => {
    if (!yours) return
    let live = true
    evaluate(input, [{ slots: yours.slots }])
      .then(([ev]) => {
        if (live) setYoursEval({ plan: yours, input, ev })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [yours, input, evaluate])
  const mine = yours && yoursEval?.plan === yours ? yoursEval : null

  const plans: PlanView[] = strategies.map((s) => ({
    key: s.type,
    slots: s.rotation.slots,
    metrics: s.metrics,
    problems: [],
    // One plain reason: the mechanism sentence (cover crops / legumes) if there is one.
    reason:
      s.card.why.find((w) => /protect|fixes|fix nitrogen/.test(w)) ??
      (s.type === 'current' ? 'This is what you told us you plant now.' : (s.card.why.find((w) => /Smallest step|different approach/.test(w)) ?? null)),
  }))
  if (yours) {
    const from = strategies.find((s) => s.type === yours.from)
    plans.push({
      key: 'yours',
      slots: yours.slots,
      metrics: mine?.ev.metrics ?? null,
      problems: mine?.ev.validity.reasons ?? [],
      reason: null,
      fromTitle: PLAIN_TITLE[yours.from],
      edits: from
        ? yours.slots.flatMap((id, i) => (id === from.rotation.slots[i] ? [] : [`${SEASON_NAMES[i]} to ${id ? CROP_BY_ID[id].name.replace(/ \(.*\)$/, '') : 'nothing'}`]))
        : [],
    })
  }
  const selected = plans.find((p) => p.key === selectedKey) ?? plans.find((p) => p.key === 'best') ?? plans[0]
  const yoursStale = selected?.key === 'yours' && (!mine || mine.input !== input)

  // The planning agent reads the latest results through this ref (tools run against the engine).
  const ground = useGround()
  // The field node's probe is in a basil pot: show its data only when basil is part of the plan.
  const showGround = [...current, ...(selected?.slots ?? [])].includes(NODE_SITE.cropId)
  const agentContext = useRef<AgentContext | null>(null)
  useEffect(() => {
    agentContext.current = result
      ? {
          result,
          input,
          evaluate,
          viewing: selected?.key ?? 'best',
          yours,
          ground: showGround ? { summary: ground.g, label: ground.label, capacity: ground.capacity } : null,
          applyPlan: (plan) => {
            setYours(plan)
            setSelectedKey('yours')
          },
          showOnLand: (option, layerKey) => {
            if (option === 'yours' ? !yours : !result.strategies.some((s) => s.type === option)) return `The plan "${option}" is not on screen right now.`
            setSelectedKey(option)
            setLayer(layerKey)
            return terrain ? null : 'The 3D view is still loading; the plan is selected and will show when it is ready.'
          },
          farmer: farm.profile ? { username: farm.profile.username, memories: farm.memories, strategies: farm.strategies } : null,
          remember: async (fact) => {
            await farm.addMemory(fact, 'helper')
          },
        }
      : null
  }, [result, input, evaluate, terrain, selected?.key, yours, farm, showGround, ground.g, ground.label, ground.capacity])
  const getAgentContext = useCallback(() => agentContext.current, [])

  /** Snapshot of the plan on the card for saving or the PDF (null while it is being recomputed). */
  const getPayload = () => {
    if (!result || !selected?.metrics || running || yoursStale) return null
    const card = selected.key === 'yours' ? (mine?.ev.card ?? null) : (strategies.find((s) => s.type === selected.key)?.card ?? null)
    return buildPayload({
      input,
      result,
      plan: {
        key: selected.key,
        slots: selected.slots,
        metrics: selected.metrics,
        problems: selected.problems,
        card,
        fromKey: selected.key === 'yours' && yours ? yours.from : undefined,
        edits: selected.edits,
      },
    })
  }

  const reviewPlan = (key: PlanKey) => {
    setAgentOpen(true)
    setAgentRequest((r) => ({
      id: (r?.id ?? 0) + 1,
      text: `Review "${PLAIN_TITLE[key]}" with me: what is good, what is risky, and which season would you change?`,
    }))
  }

  const openDetails = () => {
    setShowDetails(true)
    requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return (
    <div className="tool">
      <header className="tool-bar">
        <div className="tool-brand">
          <BrandLogo onHome={props.onHome} />
          <div>
            <h1>Your farm</h1>
            <span className="muted small">{field.name}</span>
          </div>
        </div>
        <ProfileButton onClick={() => setProfileOpen((v) => !v)} />
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
                erosionAtField={(selected.metrics ?? base)?.erosionT ?? 0}
                rotationLabel={PLAIN_TITLE[selected.key].toLowerCase()}
              />
            ) : (
              <div className="terrain-wait">
                {props.terrainError ? `The 3D view could not load (${props.terrainError}).` : 'Building the 3D view of your land from NASA SRTM elevation…'}
              </div>
            )}
          </section>

          <section className="simple-choices" aria-label="What to plant next">
            <h2>What should you plant next?</h2>
            {selected && (
              <div className={`choice-card ${running || yoursStale ? 'is-stale' : ''}`}>
                <div className="choice-goals">
                  <span className="choice-goals-q" id="goal-q">
                    What matters most to you?
                  </span>
                  <div className="choice-tiles choice-tiles--top" role="radiogroup" aria-labelledby="goal-q">
                    {GOALS.map((g) => (
                      <Tile key={g.key} kind={g.key} label={g.label} radio selected={goal === g.key} onSelect={() => setPriorities(g.priorities)} />
                    ))}
                  </div>
                </div>
                <OptionHero
                  plan={selected}
                  base={base}
                  current={current}
                  onReview={() => reviewPlan(selected.key)}
                  onUndo={
                    selected.key === 'yours' && yours
                      ? () => {
                          setSelectedKey(yours.from)
                          setYours(null)
                        }
                      : undefined
                  }
                  extra={<PlanSaveBar getPayload={getPayload} disabled={running || yoursStale || !selected.metrics} onNeedSignIn={() => setProfileOpen(true)} />}
                />
                <div className="choice-tiles choice-tiles--side" role="group" aria-label="Pick a way to plant">
                  {plans.map((p) => (
                    <Tile key={p.key} kind={p.key} label={PLAIN_TITLE[p.key]} selected={selected.key === p.key} onSelect={() => setSelectedKey(p.key)} />
                  ))}
                </div>
              </div>
            )}
            {showGround && <GroundStrip result={result} ground={ground} />}
            {showGround && <LiveFeed capacity={ground.capacity} />}
            <button type="button" className="btn details-btn" onClick={() => (showDetails ? setShowDetails(false) : openDetails())} aria-expanded={showDetails}>
              {showDetails ? 'Hide the details' : 'See all the details'}
            </button>
            <p className="small muted simple-foot">
              Based on {result.features.nYears} years of NASA weather for your field. A guide to talk over with your agronomist, not a rule.
            </p>
          </section>
        </div>
      )}

      <ProfilePanel
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onOpenSaved={
          props.onOpenSaved
            ? (s) => {
                setProfileOpen(false)
                props.onOpenSaved?.(s)
              }
            : undefined
        }
      />
      {result && selected && (
        <AgentPanel getContext={getAgentContext} open={agentOpen} onOpenChange={setAgentOpen} viewingTitle={PLAIN_TITLE[selected.key]} request={agentRequest} />
      )}

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
            {showGround && <FieldEvidence result={result} field={field} />}
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

// The combinations timeline: every rotation the generator tried, in order, one lane per stage.
// A playhead replays the search; the panel shows the combination under it and running totals.
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { CROPS } from '../engine'
import type { Slots } from '../engine/types'
import { fmt, useWidth } from './chartUtils'
import { OUTCOMES, OUTCOME_LABEL, type Timeline as TL } from './labTypes'

const LANES = [
  'Slot 1 · spring, year 1', 'Slot 2 · fall, year 1', 'Slot 3 · spring, year 2', 'Slot 4 · fall, year 2', 'Slot 5 · spring, year 3', 'Slot 6 · fall, year 3',
  'Tweak · 1 slot changed', 'Tweak · 2 slots changed',
]
const OUTCOME_VAR = ['--o-dup', '--o-rule', '--o-nosim', '--o-pruned', '--o-kept', '--o-added']
const laneOf = (tl: TL, i: number) => (tl.phase[i] === 0 ? tl.depth[i] : 5 + tl.depth[i])
const PLAY_SECONDS = 30

export function CombinationsTimeline({ tl, current }: { tl: TL; current: Slots }) {
  const [wrapRef, W] = useWidth<HTMLDivElement>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [p, setP] = useState(tl.n - 1)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const labelW = W < 560 ? 0 : 168
  const laneH = 22
  const gap = 4
  const H = LANES.length * (laneH + gap) + 22
  const plotW = Math.max(100, W - labelW - 8)

  // Running totals per outcome, plus how many complete rotations had reached the pool.
  const prefix = useMemo(() => {
    const counts = new Uint32Array((tl.n + 1) * 6)
    const pool = new Uint32Array(tl.n + 1)
    for (let i = 0; i < tl.n; i++) {
      counts.copyWithin((i + 1) * 6, i * 6, i * 6 + 6)
      counts[(i + 1) * 6 + tl.outcome[i]]++
      const adds = (tl.phase[i] === 0 && tl.depth[i] === 5 && tl.outcome[i] === 4) || tl.outcome[i] === 5
      pool[i + 1] = pool[i] + (adds ? 1 : 0)
    }
    return { counts, pool }
  }, [tl])

  // Draw lanes: each pixel column is a stack of that column's outcomes, in the lane they belong to.
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(W * dpr)
    c.height = Math.round(H * dpr)
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)
    const css = getComputedStyle(c)
    const colors = OUTCOME_VAR.map((v) => css.getPropertyValue(v).trim() || '#888')
    const laneBg = css.getPropertyValue('--surface-2').trim()
    const ink = css.getPropertyValue('--text-3').trim()
    g.font = '12px Nunito, system-ui, sans-serif'
    LANES.forEach((name, l) => {
      const y0 = l * (laneH + gap)
      g.fillStyle = laneBg
      g.fillRect(labelW, y0, plotW, laneH)
      if (labelW) { g.fillStyle = ink; g.textBaseline = 'middle'; g.fillText(name, 0, y0 + laneH / 2) }
    })
    const cols = Math.floor(plotW)
    const per = tl.n / cols
    const cnt = new Float32Array(LANES.length * 6)
    for (let col = 0; col < cols; col++) {
      const a = Math.floor(col * per)
      const b = Math.max(a + 1, Math.floor((col + 1) * per))
      cnt.fill(0)
      for (let i = a; i < b && i < tl.n; i++) cnt[laneOf(tl, i) * 6 + tl.outcome[i]]++
      const total = b - a
      for (let l = 0; l < LANES.length; l++) {
        let acc = 0
        for (let o = 0; o < 6; o++) {
          const v = cnt[l * 6 + o]
          if (!v) continue
          const h = (v / total) * laneH
          g.fillStyle = colors[o]
          g.fillRect(labelW + col, l * (laneH + gap) + laneH - acc - h, 1, h)
          acc += h
        }
      }
    }
    // Axis: combinations tried.
    g.fillStyle = ink
    g.textBaseline = 'alphabetic'
    const step = tl.n > 20000 ? 5000 : tl.n > 8000 ? 2000 : 1000
    for (let v = 0; v <= tl.n; v += step) {
      const x = labelW + (v / tl.n) * plotW
      g.textAlign = v === 0 ? 'left' : 'center'
      g.fillText(v === 0 ? '0' : `${v / 1000}k`, x, H - 4)
    }
    g.textAlign = 'left'
  }, [tl, W, H, labelW, plotW])

  // Playback.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setP((prev) => {
        const next = prev + Math.max(1, Math.round((tl.n / PLAY_SECONDS) * dt * speed))
        if (next >= tl.n - 1) { setPlaying(false); return tl.n - 1 }
        return next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, tl.n])

  const scrub = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.type === 'pointermove' && e.buttons === 0 && e.pointerType === 'mouse') return
    const r = e.currentTarget.getBoundingClientRect()
    const fx = (e.clientX - r.left - labelW) / plotW
    setPlaying(false)
    setP(Math.max(0, Math.min(tl.n - 1, Math.round(fx * (tl.n - 1)))))
  }

  const lane = laneOf(tl, p)
  const oc = OUTCOMES[tl.outcome[p]]
  const slots = Array.from(tl.slots.subarray(p * 6, p * 6 + 6))
  const isTweak = tl.phase[p] === 1
  const counts = prefix.counts.subarray((p + 1) * 6, (p + 1) * 6 + 6)
  const play = () => {
    if (p >= tl.n - 1) setP(0)
    setPlaying((v) => !v)
  }

  return (
    <div className="lab-timeline">
      <div className="lab-tl-controls">
        <button type="button" className="lab-btn" onClick={play}>{playing ? 'Pause' : p >= tl.n - 1 ? 'Replay the search' : 'Play'}</button>
        <label className="lab-inline">
          Speed
          <select id="lab-speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            <option value={0.25}>¼×</option><option value={1}>1×</option><option value={4}>4×</option>
          </select>
        </label>
        <input
          id="lab-scrub" className="lab-range" type="range" min={0} max={tl.n - 1} value={p}
          onChange={(e) => { setPlaying(false); setP(Number(e.target.value)) }} aria-label="Combination number"
        />
        <span className="lab-mono">#{fmt(p + 1)} of {fmt(tl.n)} · {fmt(tl.t[p], 0)} ms</span>
      </div>
      <div ref={wrapRef} className="lab-tl-canvas" onPointerDown={scrub} onPointerMove={scrub}>
        <canvas ref={canvas} style={{ width: W, height: H }} aria-label="Timeline of every combination the generator tried, by stage and outcome" />
        <div className="lab-playhead" style={{ left: labelW + (p / Math.max(1, tl.n - 1)) * plotW, height: H - 18 }} />
      </div>
      <div className="lab-legend">
        {OUTCOMES.map((o, i) => <span key={o}><i className="lab-sw" style={{ background: `var(${OUTCOME_VAR[i]})` }} />{OUTCOME_LABEL[o]}</span>)}
      </div>

      <div className="lab-tl-now">
        <div className="lab-tl-now-h">
          <span className="lab-eyebrow">{isTweak ? 'Neighbourhood' : 'Beam search'} · {LANES[lane]}</span>
          <span className="lab-pill" style={{ background: `var(${OUTCOME_VAR[tl.outcome[p]]})` }}>{OUTCOME_LABEL[oc]}</span>
        </div>
        <div className="lab-slots">
          {slots.map((v, k) => {
            const crop = v >= 0 ? CROPS[v] : null
            const changed = isTweak && (crop?.id ?? null) !== (current[k] ?? null)
            const filling = !isTweak && k === tl.depth[p]
            return (
              <div key={k} className={`lab-slot${v === -2 ? ' is-pending' : ''}${changed || filling ? ' is-new' : ''}`}>
                <span className="lab-slot-k">Y{Math.floor(k / 2) + 1} {k % 2 ? 'fall' : 'spring'}</span>
                <span className="lab-slot-v">{v === -2 ? '…' : crop ? crop.name.replace(/ \(.*\)$/, '') : 'nothing'}</span>
                {crop && <span className={`lab-kind lab-kind--${crop.kind}`}>{crop.kind}</span>}
              </div>
            )
          })}
        </div>
        <p className="lab-note">
          {tl.reason[p] >= 0
            ? `Rule: ${tl.reasons[tl.reason[p]]}.`
            : oc === 'duplicate'
              ? isTweak ? 'This exact combination was already tried.' : 'The same rotation started in a different year was already tried, so it counts as the same plan.'
              : oc === 'pruned'
                ? 'It passes the rules but its score at this slot was outside the top 120 (and not a top-6 specialist for any criterion), so the beam dropped it.'
                : oc === 'kept'
                  ? tl.depth[p] === 5 ? 'A complete rotation that survived the beam: it goes into the pool.' : 'Survived the beam: the next slot will be tried on top of it.'
                  : oc === 'added'
                    ? 'A valid tweak of today’s rotation: it goes into the pool.'
                    : 'Nothing in it can be grown in the weather record, so it is skipped.'}
          {isTweak && ' Highlighted slots differ from what you plant now.'}
          {!isTweak && ' The highlighted slot is the one being filled.'}
        </p>
        <div className="lab-counts">
          {OUTCOMES.map((o, i) => (
            <div key={o}><span className="lab-mono">{fmt(counts[i])}</span><span>{OUTCOME_LABEL[o]}</span></div>
          ))}
          <div className="is-total"><span className="lab-mono">{fmt(prefix.pool[p + 1])}</span><span>complete rotations in the pool so far (before removing duplicates)</span></div>
        </div>
      </div>
    </div>
  )
}

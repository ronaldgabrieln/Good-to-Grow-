import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { frameBbox, FRAME_H, FRAME_W, greennessLabel, type Frame } from './landsatFrames'
import { MONTHS } from './format'

// "los carbones" letters (public/engine-assets). w/h are the SVGs' native sizes; y is each letter's
// resting offset so the word keeps its hand-written, uneven baseline.
const BASE = `${import.meta.env.BASE_URL}engine-assets/`
const LETTERS: { src: string; w: number; h: number; y: number; gapBefore?: boolean }[] = [
  { src: 'l.svg', w: 69, h: 159, y: 0 },
  { src: 'o.svg', w: 47, h: 158, y: 16 },
  { src: 's.svg', w: 51, h: 158, y: -30 },
  { src: 'c.svg', w: 58, h: 159, y: 20, gapBefore: true },
  { src: 'a.svg', w: 45, h: 120, y: -6 },
  { src: 'r.svg', w: 54, h: 158, y: 2 },
  { src: 'b.svg', w: 46, h: 158, y: -4 },
  { src: 'o2.svg', w: 48, h: 158, y: 10 },
  { src: 'n.svg', w: 56, h: 158, y: -14 },
  { src: 'e.svg', w: 52, h: 158, y: 16 },
  { src: 's2.svg', w: 62, h: 160, y: -18 },
]

export function LettersLogo({ looping }: { looping: boolean }) {
  return (
    <div className={`letters ${looping ? 'is-looping' : ''}`} aria-label="los carbones" role="img">
      {LETTERS.map((l, i) => (
        <img
          key={l.src}
          src={BASE + l.src}
          alt=""
          className={`letter ${l.gapBefore ? 'gap-before' : ''}`}
          style={
            {
              '--w': l.w,
              '--h': l.h,
              '--y': `calc(${l.y} * var(--letter-scale) * 1px)`,
              '--i': i,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}

function frameCaption(f: Frame) {
  const d = new Date(`${f.date}T00:00:00Z`)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} · ${f.sensor} · field: ${greennessLabel(f.greenness)}`
}

/** Esri still image with exactly the same extent as the Landsat frames, shown until the first frame arrives. */
function placeholderUrl(lat: number, lon: number) {
  const b = frameBbox(lat, lon)
  return (
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?' +
    `bbox=${b.join(',')}&bboxSR=4326&imageSR=4326&size=${FRAME_W},${FRAME_H}&format=jpg&f=image`
  )
}

const FRAME_MS = 700

export function LoadingScreen(props: {
  lat: number
  lon: number
  frames: Frame[]
  missingYears: number[]
  years: [number, number]
  progress: number
  step: string
  done: boolean
  onExited: () => void
  /** Reports how far the single linear pass has played (0–1) and when it has shown the last image. */
  onPlayback: (fraction: number, complete: boolean) => void
}) {
  const sorted = useMemo(() => [...props.frames].sort((a, b) => a.year - b.year), [props.frames])
  const [activeYear, setActiveYear] = useState<number | null>(null)

  // Latest inputs for the timer without restarting it.
  const live = useRef({ frames: sorted, missing: props.missingYears, years: props.years, onPlayback: props.onPlayback })
  useEffect(() => {
    live.current = { frames: sorted, missing: props.missingYears, years: props.years, onPlayback: props.onPlayback }
  })

  // One linear pass, oldest → newest. The next year is shown when its image is ready; if it is still
  // loading we hold the current frame and wait; years with no usable image are skipped. After the
  // last image the timelapse stops on it (no looping).
  useEffect(() => {
    let cur: number | null = null
    let complete = false
    const t = setInterval(() => {
      if (complete) return
      const { frames, missing, years, onPlayback } = live.current
      const [first, last] = years
      let next: number | null = null
      let waiting = false
      for (let y = (cur ?? first - 1) + 1; y <= last; y++) {
        if (frames.some((f) => f.year === y)) {
          next = y
          break
        }
        if (!missing.includes(y)) {
          waiting = true // still loading: wait for it, never skip ahead
          break
        }
      }
      if (next !== null) {
        cur = next
        setActiveYear(next)
      } else if (!waiting) {
        complete = true
      }
      const shown = cur === null ? 0 : cur - first + 1
      onPlayback(complete ? 1 : shown / (last - first + 1), complete)
    }, FRAME_MS)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!props.done) return
    const t = setTimeout(props.onExited, 700)
    return () => clearTimeout(t)
  }, [props.done, props.onExited])

  const active = sorted.find((f) => f.year === activeYear) ?? null
  const years: number[] = []
  for (let y = props.years[0]; y <= props.years[1]; y++) years.push(y)

  return (
    <div className={`loading ${props.done ? 'is-done' : ''}`} role="status" aria-live="polite">
      <div className="loading-bg">
        <img className="loading-frame placeholder" src={placeholderUrl(props.lat, props.lon)} alt="" />
        {sorted.map((f) => (
          <img key={f.year} className={`loading-frame ${f === active ? 'is-active' : ''}`} src={f.url} alt={`Satellite image ${f.date}`} />
        ))}
        <div className="loading-shade" />
        <div className="loading-pin" aria-hidden />
      </div>

      <div className="loading-center">
        <h1>Analyzing your farm…</h1>
        <div className="loading-bar" aria-label={`${Math.round(props.progress * 100)}% done`}>
          <span style={{ width: `${Math.round(props.progress * 100)}%` }} />
        </div>
        <p className="loading-step">{props.step}</p>
        <ol className="loading-timeline" aria-label={`Satellite images by year, ${props.years[0]} to ${props.years[1]}`}>
          {years.map((y) => {
            const has = sorted.some((f) => f.year === y)
            const missing = props.missingYears.includes(y)
            // Every 5th year (plus the last one when it isn't crowded); the caption names the current frame.
            const label = y % 5 === 0 || y === props.years[0] || (y === props.years[1] && y % 5 >= 3)
            return (
              <li
                key={y}
                className={`${has ? 'has' : ''} ${missing ? 'missing' : ''} ${activeYear === y ? 'is-active' : ''}`}
                title={missing ? `${y}: no clear image` : String(y)}
              >
                <i />
                <span>{label ? y : ''}</span>
              </li>
            )
          })}
        </ol>
        <p className="loading-caption">
          {active ? frameCaption(active) : `Looking for clear Landsat images of your field since ${props.years[0]}…`}
        </p>
      </div>

      <LettersLogo looping />
    </div>
  )
}

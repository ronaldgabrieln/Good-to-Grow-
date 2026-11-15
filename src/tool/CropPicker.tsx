import { useEffect, useMemo, useRef, useState } from 'react'
import { CROPS, CROP_BY_ID, type Slots } from '../engine'

const SEARCH_DELAY_MS = 1000

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

const shortName = (id: string) => CROP_BY_ID[id].name.replace(/ \(.*\)$/, '')

function search(q: string, exclude: string[]) {
  const t = norm(q.trim())
  if (!t) return []
  return CROPS.filter((c) => !exclude.includes(c.id) && (norm(c.name).includes(t) || norm(c.nameEs).includes(t))).slice(0, 8)
}

/**
 * The farmer only says WHICH crops they grow; working out the timing is the tool's job. Each crop
 * goes to the season it can be planted in here (both-season crops balance the two), and with more
 * than one crop in a season they take turns year by year.
 */
function slotsFromCrops(ids: string[]): Slots {
  const spring: string[] = []
  const fall: string[] = []
  for (const id of ids) {
    const c = CROP_BY_ID[id]
    if (c.plant.A !== undefined && c.plant.B === undefined) spring.push(id)
    else if (c.plant.B !== undefined && c.plant.A === undefined) fall.push(id)
  }
  for (const id of ids) {
    const c = CROP_BY_ID[id]
    if (c.plant.A !== undefined && c.plant.B !== undefined) (spring.length <= fall.length ? spring : fall).push(id)
  }
  const slots: Slots = []
  for (let y = 0; y < 3; y++) {
    slots.push(spring.length ? spring[y % spring.length] : null)
    slots.push(fall.length ? fall[y % fall.length] : null)
  }
  return slots
}

function cropsFromSlots(slots: Slots): string[] {
  return [...new Set(slots.filter((x): x is string => !!x))]
}

/** "What are you planting now?" — just a search; matches appear once the farmer pauses typing. */
export function CropPicker(props: { initial: Slots; onDone: (slots: Slots) => void; onBack: () => void }) {
  const [crops, setCrops] = useState<string[]>(() => cropsFromSlots(props.initial))
  const [query, setQuery] = useState('')
  const [settled, setSettled] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setSettled(query), SEARCH_DELAY_MS)
    return () => clearTimeout(t)
  }, [query])

  const waiting = query.trim() !== '' && query !== settled
  const matches = useMemo(() => (waiting ? [] : search(settled, crops)), [waiting, settled, crops])

  const add = (id: string) => {
    setCrops((prev) => [...prev, id])
    setQuery('')
    setSettled('')
    input.current?.focus()
  }

  return (
    <div className="crops-backdrop" role="dialog" aria-modal="true" aria-labelledby="crops-title">
      <div className="crops-card">
        <h2 id="crops-title">What are you planting now?</h2>
        <form
          className="crops-search"
          onSubmit={(e) => {
            e.preventDefault()
            const first = search(query, crops)[0]
            if (first) add(first.id)
          }}
        >
          <input
            ref={input}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="tomato, cebollín, fresa…"
            aria-label="Search crops"
          />
          <svg viewBox="0 0 24 24" aria-hidden width="22" height="22">
            <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.6" />
            <path d="M15 15l5.5 5.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        </form>

        {settled.trim() !== '' && !waiting && (
          <ul className="crops-results" aria-label="Matching crops" aria-live="polite">
            {matches.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => add(c.id)}>
                  {shortName(c.id)} <span>{c.nameEs}</span>
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="crops-none">We don’t know that crop yet. Try another name.</li>}
          </ul>
        )}

        {crops.length > 0 && (
          <div className="crops-picked">
            <span className="crops-picked-label">You plant:</span>
            {crops.map((id) => (
              <span key={id} className="crops-chip">
                {shortName(id)}
                <button type="button" aria-label={`Remove ${shortName(id)}`} onClick={() => setCrops(crops.filter((x) => x !== id))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="crops-actions">
          <button type="button" className="crops-back" onClick={props.onBack}>
            Back to map
          </button>
          {crops.length > 0 && (
            <button type="button" className="crops-go" onClick={() => props.onDone(slotsFromCrops(crops))}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  )
}


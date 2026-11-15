import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineResult } from '../engine'
import { parseNodeCsv, summarizeGround, type GroundSummary, type SoilCapacity } from '../engine/ground'

/** Recordings shipped with the app (field-data/ holds the originals). */
export const RECORDINGS = [
  { url: `${import.meta.env.BASE_URL}data/ground/node-2026-11-15.csv`, label: 'night of 14–15 Nov 2026' },
  { url: `${import.meta.env.BASE_URL}data/ground/node-2026-11-15-sun.csv`, label: 'sunny morning, 15 Nov 2026' },
]
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const CAPACITY_KEY = 'goodtogrow.soilCapacity'

function readCapacity(): SoilCapacity | null {
  try {
    const v = JSON.parse(localStorage.getItem(CAPACITY_KEY) ?? 'null')
    return v && typeof v.raw === 'number' && typeof v.ms === 'number' && typeof v.label === 'string' ? v : null
  } catch {
    return null
  }
}

function saveCapacity(c: SoilCapacity) {
  try {
    localStorage.setItem(CAPACITY_KEY, JSON.stringify(c))
  } catch {
    // Storage blocked: the peak is still kept for this visit.
  }
}

export interface GroundState {
  g: GroundSummary | null
  /** Where the readings came from ("night of 14–15 Nov 2026" or the uploaded file name). */
  label: string
  error: string | null
  /** The soil's 100 %: the highest peak seen so far, across every recording loaded in this browser. */
  capacity: SoilCapacity | null
  /** True when the loaded recording beat the previous highest peak (the soil was watered more). */
  newPeak: boolean
  load: (text: string, name: string) => void
  /** Load one of RECORDINGS by index. */
  pick: (i: number) => void
  /** Make the loaded recording's peak the 100 % again (e.g. after moving the probe). */
  resetCapacity: () => void
}

/** Field-node readings: the bundled night on start; the farmer can switch recordings or upload a CSV. */
export function useGround(): GroundState {
  const [g, setG] = useState<GroundSummary | null>(null)
  const [label, setLabel] = useState(RECORDINGS[0].label)
  const [error, setError] = useState<string | null>(null)
  const [capacity, setCapacity] = useState<SoilCapacity | null>(readCapacity)
  const capRef = useRef<SoilCapacity | null>(capacity)
  const [newPeak, setNewPeak] = useState(false)

  const load = useCallback((text: string, name: string) => {
    try {
      const s = summarizeGround(parseNodeCsv(text))
      if (!s) throw new Error('fewer than two readings with a soil value')
      const prev = capRef.current
      const higher = !prev || s.peakRaw > prev.raw
      if (higher) {
        const next = { raw: s.peakRaw, ms: s.peakMs, label: name }
        capRef.current = next
        saveCapacity(next)
        setCapacity(next)
      }
      setNewPeak(higher && prev !== null)
      setG(s)
      setLabel(name)
      setError(null)
    } catch (e) {
      setError(`${name}: ${(e as Error).message}`)
    }
  }, [])

  const resetCapacity = useCallback(() => {
    if (!g) return
    const next = { raw: g.peakRaw, ms: g.peakMs, label }
    capRef.current = next
    saveCapacity(next)
    setCapacity(next)
    setNewPeak(false)
  }, [g, label])

  const pick = useCallback(
    (i: number) => {
      const rec = RECORDINGS[i]
      if (!rec) return
      fetch(rec.url)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((t) => load(t, rec.label))
        .catch((e) => setError(`Could not load the bundled field-node data (${(e as Error).message}).`))
    },
    [load],
  )

  useEffect(() => pick(0), [pick])

  return { g, label, error, capacity, newPeak, load, pick, resetCapacity }
}

/** Every bundled recording, summarised (for the evidence windows, which need the night and the sun run together). */
export function useRecordingSummaries(): (GroundSummary | null)[] {
  const [all, setAll] = useState<(GroundSummary | null)[]>(() => RECORDINGS.map(() => null))
  useEffect(() => {
    let live = true
    Promise.all(
      RECORDINGS.map((r) =>
        fetch(r.url)
          .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
          .then((t) => summarizeGround(parseNodeCsv(t)))
          .catch(() => null),
      ),
    ).then((s) => {
      if (live) setAll(s)
    })
    return () => {
      live = false
    }
  }, [])
  return all
}

/** NASA POWER mean daily reference ET for the month the readings start in. */
export function et0ForMonth(result: EngineResult, g: GroundSummary | null) {
  const month = g ? new Date(g.startMs).getUTCMonth() : 10
  return { month, et0Day: result.features.monthly[month].et0MeanMm / DAYS_IN_MONTH[month] }
}

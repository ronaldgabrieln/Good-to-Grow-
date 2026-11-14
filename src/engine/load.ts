import { DEFAULT_SOIL, parseSoilGrids, soilGridsUrl } from './soil'
import type { Soil, WeatherSeries } from './types'
import { blendColumns, columnsFromPowerResponse, powerUrl, type PowerColumns } from './weather'

export interface FieldData {
  power: PowerColumns
  soil: Soil
  source: WeatherSeries['source']
  notes: string[]
}

interface DemoBundle {
  power: PowerColumns
  soilgrids: unknown
}

const DEMO_URL = `${import.meta.env.BASE_URL}data/maneadero-demo.json`
const CACHE_PREFIX = 'rotation-engine:v2:'
/** SoilGrids can be very slow; never let it hold the analysis for more than ~17 s. */
const SOIL_TIMEOUT_MS = 8000

export async function loadDemoData(): Promise<FieldData> {
  const res = await fetch(DEMO_URL)
  if (!res.ok) throw new Error(`Demo data missing (${res.status}). Run: node scripts/build-demo-data.mjs`)
  const b = (await res.json()) as DemoBundle
  return {
    power: b.power,
    soil: parseSoilGrids(b.soilgrids) ?? DEFAULT_SOIL,
    source: 'demo',
    notes: ['Using the bundled Maneadero dataset (NASA POWER 1995–2024 + SoilGrids).'],
  }
}

function cacheKey(lat: number, lon: number) {
  return `${CACHE_PREFIX}${lat.toFixed(3)},${lon.toFixed(3)}`
}

function readCache(lat: number, lon: number): FieldData | null {
  try {
    const raw = localStorage.getItem(cacheKey(lat, lon))
    return raw ? ({ ...(JSON.parse(raw) as FieldData), source: 'cache' } as FieldData) : null
  } catch {
    return null
  }
}

function writeCache(lat: number, lon: number, d: FieldData) {
  try {
    localStorage.setItem(cacheKey(lat, lon), JSON.stringify(d))
  } catch {
    // Storage full or blocked: caching is a convenience only.
  }
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return await res.json()
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error(`timed out after ${Math.round(timeoutMs / 1000)} s`, { cause: e })
    throw e
  } finally {
    clearTimeout(t)
  }
}

/**
 * MERRA-2 cells are 0.5° lat × 0.625° lon. If the field is within 0.1° of a cell edge, fetch the
 * cell on each side and average them; a coast/inland boundary otherwise flips the climate.
 */
async function fetchPowerNearBoundary(lat: number, lon: number): Promise<PowerColumns> {
  const lonEdge = (Math.round((lon + 0.3125) / 0.625) * 0.625) - 0.3125
  const latEdge = Math.round((lat + 0.25) / 0.5) * 0.5 - 0.25
  const points: [number, number][] = []
  if (Math.abs(lon - lonEdge) < 0.1) points.push([lat, lonEdge - 0.05], [lat, lonEdge + 0.05])
  else if (Math.abs(lat - latEdge) < 0.1) points.push([latEdge - 0.05, lon], [latEdge + 0.05, lon])
  else points.push([lat, lon])
  const cols = await Promise.all(
    points.map(async ([la, lo]) => columnsFromPowerResponse(await fetchJson(powerUrl(la, lo), 60000), la, lo)),
  )
  return blendColumns(cols, lat, lon)
}

/**
 * Load weather + soil for a field: localStorage cache → live NASA POWER / SoilGrids → bundled demo.
 * Soil failure alone does not block: the default valley soil is used and a note is returned.
 */
export type LoadStep = 'weather' | 'soil'

export async function loadFieldData(
  lat: number,
  lon: number,
  opts: { forceLive?: boolean; onStep?: (step: LoadStep) => void } = {},
): Promise<FieldData> {
  if (!opts.forceLive) {
    const cached = readCache(lat, lon)
    if (cached) return cached
  }
  const notes: string[] = []
  opts.onStep?.('weather')
  // Weather and soil are fetched in parallel; SoilGrids is often the slower of the two.
  const soilPromise: Promise<{ soil: Soil; note?: string }> = fetchJson(soilGridsUrl(lat, lon), SOIL_TIMEOUT_MS)
    // SoilGrids is often busy (rate limits surface as network errors): retry once.
    .catch(() => new Promise((r) => setTimeout(r, 1500)).then(() => fetchJson(soilGridsUrl(lat, lon), SOIL_TIMEOUT_MS)))
    .then((j) => {
      const s = parseSoilGrids(j)
      return s ? { soil: s } : { soil: DEFAULT_SOIL, note: 'SoilGrids has no data at this point (urban/water mask); using default valley soil.' }
    })
    .catch((e: Error) => ({ soil: DEFAULT_SOIL, note: `SoilGrids request failed (${e.message}); using default valley soil.` }))
  let power: PowerColumns
  try {
    power = await fetchPowerNearBoundary(lat, lon)
    if ((power.cells?.length ?? 1) > 1) notes.push('Field is near a NASA POWER cell boundary: the two neighbouring cells were averaged.')
  } catch (e) {
    const demo = await loadDemoData()
    demo.notes.unshift(`NASA POWER request failed (${(e as Error).message}); fell back to demo data.`)
    return demo
  }
  opts.onStep?.('soil')
  const { soil, note } = await soilPromise
  if (note) notes.push(note)
  const data: FieldData = { power, soil, source: 'live', notes: [note ? `Fetched live from NASA POWER.` : `Fetched live from NASA POWER and SoilGrids.`, ...notes] }
  writeCache(lat, lon, data)
  return data
}

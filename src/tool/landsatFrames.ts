// One clear Landsat image of the field per year, covering the same period the engine analyzes
// (1995 → today). Scenes come from the NASA/USGS Landsat Collection 2 archive on Microsoft
// Planetary Computer: a keyless STAC search finds the scenes and its tiler crops every frame to the
// SAME bounding box, so the frames line up exactly and play as a plain timelapse.

const STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1/search'
const TILER = 'https://planetarycomputer.microsoft.com/api/data/v1/item/bbox'
// Planetary Computer's default true-color rendering for Landsat C2 L2.
const RENDER =
  'assets=red&assets=green&assets=blue&nodata=0&color_formula=' + encodeURIComponent('gamma RGB 2.7, saturation 1.5, sigmoidal RGB 15 0.55')

/** Frame extent around the field (~31 × 19 km) and output size. Same for every frame. */
const HALF_LON = 0.165
const HALF_LAT = 0.0875
export const FRAME_W = 1024
export const FRAME_H = 640

export interface Frame {
  year: number
  date: string
  sensor: string
  sceneId: string
  /** Blob URL of the frame (field at the center). */
  url: string
  /** Scene cloud cover, % (from the Landsat metadata). */
  cloud: number
  /** Excess-green index of a ~600 m window around the field (−1..1; > 0.06 ≈ growing crop). */
  greenness: number
}

export function greennessLabel(g: number): string {
  if (g >= 0.06) return 'green crop'
  if (g >= 0.025) return 'some vegetation'
  return 'mostly bare soil'
}

export function frameBbox(lat: number, lon: number): [number, number, number, number] {
  return [lon - HALF_LON, lat - HALF_LAT, lon + HALF_LON, lat + HALF_LAT]
}

interface StacItem {
  id: string
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] }
  properties: { datetime: string; platform: string; 'eo:cloud_cover': number }
}

function inRing(x: number, y: number, ring: number[][]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Fraction of a 7×7 grid over the frame that falls inside the scene footprint. */
function coverage(item: StacItem, bbox: number[]) {
  const polys = (item.geometry.type === 'Polygon' ? [item.geometry.coordinates] : item.geometry.coordinates) as number[][][][]
  let hit = 0
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      const x = bbox[0] + ((bbox[2] - bbox[0]) * i) / 6
      const y = bbox[1] + ((bbox[3] - bbox[1]) * j) / 6
      if (polys.some((p) => inRing(x, y, p[0]))) hit++
    }
  }
  return hit / 49
}

/** Landsat 7 lost its scan-line corrector on 31 May 2003; later scenes have black stripes. */
function usable(item: StacItem) {
  return !(item.properties.platform === 'landsat-7' && item.properties.datetime >= '2003-05-31')
}

function sensorName(platform: string) {
  return platform.replace('landsat-', 'Landsat ')
}

function limiter(max: number) {
  let active = 0
  const queue: (() => void)[] = []
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((r) => queue.push(r))
    active++
    try {
      return await fn()
    } finally {
      active--
      queue.shift()?.()
    }
  }
}

/** Per-attempt time limit; combined with the caller's signal so leaving the screen still cancels. */
const REQUEST_TIMEOUT_MS = 45000
const MAX_ATTEMPTS = 4

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })

/**
 * fetch with retries for transient failures (network errors, timeouts, 429 rate limits, 5xx).
 * Planetary Computer throttles bursts, so a busy server must not be mistaken for "no image".
 */
async function fetchRetry(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) })
      if (res.ok) return res
      if (res.status !== 429 && res.status < 500) throw Object.assign(new Error(`HTTP ${res.status}`), { permanent: true })
      lastError = new Error(`HTTP ${res.status}`)
      const retryAfter = Number(res.headers.get('Retry-After'))
      if (attempt < MAX_ATTEMPTS) await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt, signal)
    } catch (e) {
      if (signal.aborted || (e as { permanent?: boolean }).permanent) throw e
      lastError = e
      if (attempt < MAX_ATTEMPTS) await sleep(1000 * 2 ** attempt, signal)
    }
  }
  throw lastError
}

async function searchYear(
  lat: number,
  lon: number,
  year: number,
  signal: AbortSignal,
  window: 'autumn' | 'year',
  maxCloud: number,
): Promise<StacItem[]> {
  const today = new Date().toISOString()
  const start = window === 'autumn' ? `${year}-09-15T00:00:00Z` : `${year}-01-01T00:00:00Z`
  let end = `${year}-12-31T23:59:59Z`
  if (end > today) end = today
  if (start > end) return []
  const res = await fetchRetry(
    STAC,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['landsat-c2-l2'],
        intersects: { type: 'Point', coordinates: [lon, lat] },
        datetime: `${start}/${end}`,
        query: { 'eo:cloud_cover': { lt: maxCloud } },
        sortby: [{ field: 'eo:cloud_cover', direction: 'asc' }],
        limit: 50,
      }),
    },
    signal,
  )
  return ((await res.json()) as { features: StacItem[] }).features
}

/**
 * Candidate scenes for one year, best first: clear autumn scenes covering the whole frame, then any
 * month, then hazier scenes, and finally scenes that cover only part of the frame (a field near the
 * edge of a Landsat path is better shown partly than skipped).
 */
async function candidatesForYear(lat: number, lon: number, year: number, bbox: number[], signal: AbortSignal): Promise<StacItem[]> {
  const out: StacItem[] = []
  const seen = new Set<string>()
  const add = (items: StacItem[]) => {
    for (const it of items) {
      if (seen.has(it.id)) continue
      seen.add(it.id)
      out.push(it)
    }
  }
  const tiers: ['autumn' | 'year', number][] = [
    ['autumn', 20],
    ['year', 20],
    ['year', 60],
  ]
  const partial: { it: StacItem; cov: number }[] = []
  for (const [window, maxCloud] of tiers) {
    const items = (await searchYear(lat, lon, year, signal, window, maxCloud)).filter(usable)
    const scored = items.map((it) => ({ it, cov: coverage(it, bbox) }))
    add(scored.filter((x) => x.cov >= 0.98).sort((a, b) => a.it.properties['eo:cloud_cover'] - b.it.properties['eo:cloud_cover']).map((x) => x.it))
    partial.push(...scored.filter((x) => x.cov >= 0.5 && x.cov < 0.98))
    if (out.length >= 3) break
  }
  add(partial.sort((a, b) => b.cov - a.cov || a.it.properties['eo:cloud_cover'] - b.it.properties['eo:cloud_cover']).map((x) => x.it))
  return out
}

async function renderFrame(item: StacItem, bbox: number[], lat: number, signal: AbortSignal): Promise<{ url: string; greenness: number }> {
  const url = `${TILER}/${bbox.map((v) => v.toFixed(5)).join(',')}/${FRAME_W}x${FRAME_H}.jpg?collection=landsat-c2-l2&item=${item.id}&${RENDER}`
  const res = await fetchRetry(url, {}, signal)
  const blob = await res.blob()
  const bmp = await createImageBitmap(blob)
  const c = document.createElement('canvas')
  c.width = 20
  c.height = 20
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  // ~600 m window at the frame center (the field).
  const frameWidthKm = HALF_LON * 2 * 111.32 * Math.cos((lat * Math.PI) / 180)
  const sw = (FRAME_W * 0.6) / frameWidthKm
  ctx.drawImage(bmp, FRAME_W / 2 - sw / 2, FRAME_H / 2 - sw / 2, sw, sw, 0, 0, 20, 20)
  const d = ctx.getImageData(0, 0, 20, 20).data
  let exg = 0
  let n = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue
    const sum = d[i] + d[i + 1] + d[i + 2] || 1
    exg += (2 * d[i + 1] - d[i] - d[i + 2]) / sum
    n++
  }
  return { url: URL.createObjectURL(blob), greenness: n ? exg / n : 0 }
}

export type MissingReason = 'no-image' | 'failed'

/**
 * Find one frame per year from `fromYear` to today. Oldest years are requested first so the
 * timelapse can start from the beginning. Every year ends in exactly one callback: `onFrame`, or
 * `onMissing` with the reason (no usable scene exists, or every attempt failed after retries).
 */
export async function findFrames(
  lat: number,
  lon: number,
  opts: {
    fromYear: number
    toYear?: number
    signal: AbortSignal
    onFrame?: (f: Frame) => void
    onMissing?: (year: number, reason: MissingReason) => void
  },
): Promise<Frame[]> {
  const run = limiter(6)
  const bbox = frameBbox(lat, lon)
  const to = opts.toYear ?? new Date().getUTCFullYear()
  const frames: Frame[] = []
  const years: number[] = []
  for (let y = opts.fromYear; y <= to; y++) years.push(y)
  await Promise.all(
    years.map((year) =>
      run(async () => {
        let candidates: StacItem[]
        try {
          candidates = await candidatesForYear(lat, lon, year, bbox, opts.signal)
        } catch (e) {
          if (!opts.signal.aborted) {
            console.warn(`Landsat ${year}: search failed after retries`, e)
            opts.onMissing?.(year, 'failed')
          }
          return
        }
        if (candidates.length === 0) {
          opts.onMissing?.(year, 'no-image')
          return
        }
        // If a scene fails to render, fall back to the next best one before giving up on the year.
        for (const scene of candidates.slice(0, 4)) {
          try {
            const { url, greenness } = await renderFrame(scene, bbox, lat, opts.signal)
            if (opts.signal.aborted) {
              URL.revokeObjectURL(url)
              return
            }
            const f: Frame = {
              year,
              date: scene.properties.datetime.slice(0, 10),
              sensor: sensorName(scene.properties.platform),
              sceneId: scene.id,
              url,
              cloud: scene.properties['eo:cloud_cover'],
              greenness,
            }
            frames.push(f)
            opts.onFrame?.(f)
            return
          } catch (e) {
            if (opts.signal.aborted) return
            console.warn(`Landsat ${year}: scene ${scene.id} failed, trying the next one`, e)
          }
        }
        opts.onMissing?.(year, 'failed')
      }),
    ),
  )
  return frames.sort((a, b) => a.year - b.year)
}

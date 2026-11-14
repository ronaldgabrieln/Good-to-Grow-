// Terrain of the land around the field, for the 3D view.
//
// Elevation: AWS Terrain Tiles ("terrarium" PNGs; NASA SRTM 30 m over Mexico), keyless + CORS.
// Imagery:   Esri World Imagery export of the same box (sharp, keyless; attribution shown).
// From the elevation grid we derive slope, the RUSLE slope factor (LS) per cell and a D8 flow
// accumulation (where runoff water concentrates). The engine's per-rotation soil loss at the
// field is then spread over the terrain in proportion to LS, so the map and the cards agree.

import { lsFactor } from '../../engine'

const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
const Z = 13 // ~16 m/px here; SRTM itself is ~30 m
const TILE = 256

export const CHUNK_HALF_M = 3000 // 6 × 6 km around the field
export const GRID = 200 // ≈ 30 m cells, the SRTM resolution
export const SLOPE_LENGTH_M = 100
const FOCUS_NEAR_M = 1200
const FOCUS_FAR_M = 2600

export interface Terrain {
  n: number
  sizeM: number
  cellM: number
  bbox: [number, number, number, number] // west, south, east, north
  elev: Float32Array
  minElev: number
  maxElev: number
  slopePct: Float32Array
  ls: Float32Array
  /** Number of upslope cells draining through each cell (D8). */
  flow: Float32Array
  field: { elevationM: number; slopePct: number; ls: number }
  imageUrl: string
}

function worldPx(lat: number, lon: number) {
  const n = 2 ** Z * TILE
  const s = Math.sin((lat * Math.PI) / 180)
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n }
}

async function loadImage(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`${res.status} for ${url}`)
  return createImageBitmap(await res.blob())
}

export function chunkBbox(lat: number, lon: number): [number, number, number, number] {
  const dLat = CHUNK_HALF_M / 111320
  const dLon = CHUNK_HALF_M / (111320 * Math.cos((lat * Math.PI) / 180))
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat]
}

export function imageryUrl(bbox: number[], px = 2048) {
  return (
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?' +
    `bbox=${bbox.join(',')}&bboxSR=4326&imageSR=4326&size=${px},${px}&format=jpg&f=image`
  )
}

export async function loadTerrain(lat: number, lon: number, signal: AbortSignal): Promise<Terrain> {
  const bbox = chunkBbox(lat, lon)
  const [w, s, e, nth] = bbox
  const nw = worldPx(nth, w)
  const se = worldPx(s, e)
  const tx0 = Math.floor(nw.x / TILE)
  const ty0 = Math.floor(nw.y / TILE)
  const tx1 = Math.floor(se.x / TILE)
  const ty1 = Math.floor(se.y / TILE)

  // Stitch the elevation tiles.
  const canvas = document.createElement('canvas')
  canvas.width = (tx1 - tx0 + 1) * TILE
  canvas.height = (ty1 - ty0 + 1) * TILE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const jobs: Promise<void>[] = []
  for (let tx = tx0; tx <= tx1; tx++)
    for (let ty = ty0; ty <= ty1; ty++)
      jobs.push(loadImage(`${TERRARIUM}/${Z}/${tx}/${ty}.png`, signal).then((img) => ctx.drawImage(img, (tx - tx0) * TILE, (ty - ty0) * TILE)))
  await Promise.all(jobs)
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const decode = (x: number, y: number) => {
    const xi = Math.max(0, Math.min(canvas.width - 1, Math.round(x)))
    const yi = Math.max(0, Math.min(canvas.height - 1, Math.round(y)))
    const i = (yi * canvas.width + xi) * 4
    return px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768
  }

  // Resample to an n × n grid, row 0 = north.
  const n = GRID
  const elev = new Float32Array(n * n)
  let minElev = Infinity
  let maxElev = -Infinity
  for (let r = 0; r < n; r++) {
    const lat = nth - ((nth - s) * r) / (n - 1)
    for (let c = 0; c < n; c++) {
      const lonC = w + ((e - w) * c) / (n - 1)
      const p = worldPx(lat, lonC)
      const v = Math.max(-50, decode(p.x - tx0 * TILE, p.y - ty0 * TILE))
      elev[r * n + c] = v
      if (v < minElev) minElev = v
      if (v > maxElev) maxElev = v
    }
  }

  const sizeM = CHUNK_HALF_M * 2
  const cellM = sizeM / (n - 1)
  const at = (r: number, c: number) => elev[Math.max(0, Math.min(n - 1, r)) * n + Math.max(0, Math.min(n - 1, c))]

  // Slope (Horn 1981) and RUSLE LS per cell.
  const slopePct = new Float32Array(n * n)
  const ls = new Float32Array(n * n)
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const dzdx =
        (at(r - 1, c + 1) + 2 * at(r, c + 1) + at(r + 1, c + 1) - (at(r - 1, c - 1) + 2 * at(r, c - 1) + at(r + 1, c - 1))) / (8 * cellM)
      const dzdy =
        (at(r + 1, c - 1) + 2 * at(r + 1, c) + at(r + 1, c + 1) - (at(r - 1, c - 1) + 2 * at(r - 1, c) + at(r - 1, c + 1))) / (8 * cellM)
      const sp = Math.hypot(dzdx, dzdy) * 100
      slopePct[r * n + c] = sp
      ls[r * n + c] = lsFactor(sp, SLOPE_LENGTH_M)
    }
  }

  // D8 flow accumulation: visit cells from high to low, pass water to the steepest lower neighbour.
  const flow = new Float32Array(n * n).fill(1)
  const order = Array.from({ length: n * n }, (_, i) => i).sort((a, b) => elev[b] - elev[a])
  const nbr = [
    [-1, -1, Math.SQRT2], [-1, 0, 1], [-1, 1, Math.SQRT2], [0, -1, 1],
    [0, 1, 1], [1, -1, Math.SQRT2], [1, 0, 1], [1, 1, Math.SQRT2],
  ]
  for (const i of order) {
    const r = Math.floor(i / n)
    const c = i % n
    let best = -1
    let bestDrop = 0
    for (const [dr, dc, dist] of nbr) {
      const rr = r + dr
      const cc = c + dc
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue
      const drop = (elev[i] - elev[rr * n + cc]) / dist
      if (drop > bestDrop) {
        bestDrop = drop
        best = rr * n + cc
      }
    }
    if (best >= 0) flow[best] += flow[i]
  }

  const mid = Math.floor(n / 2) * n + Math.floor(n / 2)
  return {
    n,
    sizeM,
    cellM,
    bbox,
    elev,
    minElev,
    maxElev,
    slopePct,
    ls,
    flow,
    field: { elevationM: elev[mid], slopePct: slopePct[mid], ls: ls[mid] },
    imageUrl: imageryUrl(bbox),
  }
}

/** Soil-loss classes (t/ha/yr) and their sequential colours (one hue, light → dark). */
export const EROSION_CLASSES = [
  { max: 2, label: 'under 2', color: null },
  { max: 5, label: '2–5', color: '#f9c4a8' },
  { max: 10, label: '5–10', color: '#f08a5d' },
  { max: 20, label: '10–20', color: '#d2501f' },
  { max: Infinity, label: 'over 20', color: '#8f2f0c' },
] as const

/**
 * Paint the texture: satellite image, then optional overlays. Soil loss per cell is the selected
 * rotation's modeled loss at the field, scaled by that cell's LS relative to the field's LS.
 */
export function paintTexture(
  ctx: CanvasRenderingContext2D,
  size: number,
  t: Terrain,
  image: CanvasImageSource | null,
  opts: { erosionAtField: number | null; fieldLs: number; showWater: boolean },
) {
  ctx.clearRect(0, 0, size, size)
  if (image) ctx.drawImage(image, 0, 0, size, size)
  else {
    ctx.fillStyle = '#c9c2a7'
    ctx.fillRect(0, 0, size, size)
  }
  const cell = size / t.n
  if (opts.erosionAtField !== null) {
    const k = opts.erosionAtField / Math.max(1e-6, opts.fieldLs)
    // Full strength around the field, fading further away so the farmer's own land stands out.
    const mid = (t.n - 1) / 2
    const near = FOCUS_NEAR_M / t.cellM
    const far = FOCUS_FAR_M / t.cellM
    for (let i = 0; i < t.n * t.n; i++) {
      const loss = k * t.ls[i]
      const cls = EROSION_CLASSES.find((c) => loss < c.max)!
      if (!cls.color) continue
      const d = Math.hypot((i % t.n) - mid, Math.floor(i / t.n) - mid)
      const focus = d <= near ? 1 : Math.max(0.25, 1 - (0.75 * (d - near)) / (far - near))
      ctx.globalAlpha = 0.65 * focus
      ctx.fillStyle = cls.color
      ctx.fillRect((i % t.n) * cell, Math.floor(i / t.n) * cell, cell + 0.6, cell + 0.6)
    }
    ctx.globalAlpha = 1
  }
  if (opts.showWater) {
    const minCells = 40 // ≈ 3.6 ha draining through the cell
    for (let i = 0; i < t.n * t.n; i++) {
      const f = t.flow[i]
      if (f < minCells) continue
      const strength = Math.min(1, Math.log10(f / minCells) / 2.2)
      ctx.fillStyle = `rgba(42, 120, 214, ${0.45 + 0.5 * strength})`
      const w = cell * (0.7 + 1.3 * strength)
      ctx.fillRect((i % t.n) * cell + (cell - w) / 2, Math.floor(i / t.n) * cell + (cell - w) / 2, w, w)
    }
  }
}

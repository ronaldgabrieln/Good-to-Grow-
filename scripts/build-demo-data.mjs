// Fetches NASA POWER daily weather + ISRIC SoilGrids soil for the demo field
// and writes a compact bundle to public/data/. The app uses this bundle as an
// offline fallback so the demo never depends on conference Wi-Fi.
//
// Usage: node scripts/build-demo-data.mjs [lat] [lon] [outName]
// Default: Maneadero valley, Ensenada, Baja California.

import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const lat = Number(process.argv[2] ?? 31.69)
const lon = Number(process.argv[3] ?? -116.57)
const outName = process.argv[4] ?? 'maneadero-demo.json'
const START = '19950101'
const END = '20241231'

const POWER_PARAMS = ['T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'ALLSKY_SFC_SW_DWN', 'RH2M', 'WS2M']

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.json()
}

const powerUrl = (la, lo) =>
  `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${POWER_PARAMS.join(',')}` +
  `&community=AG&longitude=${lo}&latitude=${la}&start=${START}&end=${END}&format=JSON`

// MERRA-2 cells are 0.625° wide in longitude. Maneadero sits on the edge at -116.5625 between a
// coastal cell and an inland cell, so (like the app's live loader) both are fetched and averaged.
const lonEdge = Math.round((lon + 0.3125) / 0.625) * 0.625 - 0.3125
const points = Math.abs(lon - lonEdge) < 0.1 ? [lonEdge - 0.05, lonEdge + 0.05] : [lon]
const soilUrl =
  `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon}&lat=${lat}` +
  ['clay', 'sand', 'silt', 'soc', 'phh2o'].map((p) => `&property=${p}`).join('') +
  ['0-5cm', '5-15cm', '15-30cm', '30-60cm'].map((d) => `&depth=${d}`).join('') +
  '&value=mean'

console.log(`Fetching NASA POWER for ${points.length} cell(s)…`)
const cells = []
for (const lo of points) cells.push(await getJson(powerUrl(lat, lo)))
console.log('Fetching SoilGrids…')
const soil = await getJson(soilUrl)

const params = cells.map((c) => c.properties.parameter)
const keys = Object.keys(params[0].T2M_MAX).sort()
const col = (name, digits = 2) =>
  keys.map((k) => Number((params.reduce((s, p) => s + p[name][k], 0) / params.length).toFixed(digits)))

const bundle = {
  power: {
    lat,
    lon,
    gridElevationM: cells.reduce((s, c) => s + c.geometry.coordinates[2], 0) / cells.length,
    start: `${keys[0].slice(0, 4)}-${keys[0].slice(4, 6)}-${keys[0].slice(6, 8)}`,
    cells: cells.map((c, i) => ({ lat, lon: points[i], elevationM: c.geometry.coordinates[2] })),
    days: keys.length,
    fetchedAt: new Date().toISOString(),
    apiVersion: cells[0].header?.api?.version,
    tmax: col('T2M_MAX'),
    tmin: col('T2M_MIN'),
    rain: col('PRECTOTCORR'),
    rad: col('ALLSKY_SFC_SW_DWN'),
    rh: col('RH2M', 1),
    wind: col('WS2M'),
  },
  soilgrids: soil,
}

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data')
await mkdir(outDir, { recursive: true })
const outFile = path.join(outDir, outName)
await writeFile(outFile, JSON.stringify(bundle))
console.log(`Wrote ${outFile} (${keys.length} days)`)

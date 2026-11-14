# Rotation planner — crop rotation decision support (NASA Space Apps)

Helps a farmer choose a 3-year crop rotation for **one field**, using 30 years of that field's own
NASA weather history, its soil, crop traits and the farmer's priorities. Demo region: **Maneadero
valley, Ensenada, Baja California** (irrigated vegetables, ~165 mm rain/yr, saline wells).

> The decision engine is the product; maps and 3D views display what it decides.

```bash
npm install
npm run dev          # tool at http://localhost:5173
npm test             # engine tests (FAO-56 checks, rules, full replay on Maneadero data)
npm run demo-data    # re-download the bundled Maneadero dataset (NASA POWER + SoilGrids)
```

## The farmer's flow

1. **Pick the field on a map.** Satellite map (MapLibre + Esri World Imagery). Tap your field or use "Use my location", then press "Analyze this field".
2. **"Analyzing your farm…"**: a full-screen timelapse of that exact spot, one clear **Landsat** image per year from **1995 (the first year of the weather analysis) to today**, played once, strictly in order, with a fixed frame (no zoom or pan). If a year is still loading the timelapse waits for it; years with no usable image are skipped; results open only after the last image has been shown. It comes with a year timeline, a progress bar that follows the real steps (NASA POWER → SoilGrids → rotation replay → images), and the *los carbones* letters popping in one by one ([LoadingScreen.tsx](src/tool/LoadingScreen.tsx), letters in [public/engine-assets/](public/engine-assets/)).
3. **Results**: climate history, *Your field from space* filmstrip, rotation calendar, trade-off table and strategy cards. "Change field" goes back to the map.

Frames come from the NASA/USGS Landsat Collection 2 archive on Microsoft Planetary Computer, which is keyless and works from the browser ([landsatFrames.ts](src/tool/landsatFrames.ts)). For each year a STAC search finds scenes over the field (autumn first, then any month). The app keeps a scene whose footprint covers the whole frame with the fewest clouds, and the tiler crops every frame to the same bounding box. Landsat 7 scenes after its 2003 scan-line failure are skipped (black stripes), so **2012 has no image**; the timeline marks it as missing. Google Earth Engine could make the same timelapse, but it needs a Google Cloud project, OAuth or a service account, and a server.

## What the engine does

1. **Field + priorities**: map-picked location, slope, well-water salinity, irrigation system, current rotation, 7 priority sliders.
2. **NASA data**: NASA POWER daily weather 1995–2024 (live from the browser, cached, with a bundled offline fallback) and ISRIC SoilGrids soil.
3. **Agronomic features**: FAO-56 Penman–Monteith ET₀, rain/ET₀ by month, frost and heat probabilities, dry years, rainfall erosivity.
4. **Crop knowledge base**: 36 cash, forage and cover crops ([src/engine/crops.ts](src/engine/crops.ts)) with FAO-56, FAO-29 salinity, ECOCROP and SARE values, each cited.
5. **Rotation engine**: generates thousands of valid 3-year rotations (beam search plus every 1–2-season tweak of the current rotation), grows every crop day by day in every historical year (soil-water bucket, irrigation + salinity leaching, frost, heat, erosion), and scores each rotation on water, income, soil carbon, nitrogen, erosion, pest break and risk.
6. **Strategy cards**: current rotation vs. *small change*, *best match* and *a different approach*. Each card covers why it was suggested, evidence tagged observed/modeled/assumed, benefits, trade-offs, risks, information gaps and a "talk to your extension agent about…" line. Every sentence is built from computed numbers.

Climate sliders (+°C, ±rain) shift all 30 years and re-run everything (~0.4 s, in a Web Worker).

### Data honesty built in
- The Maneadero field sits on the boundary between a coastal and an inland POWER grid cell, so both are fetched and averaged (any field within 0.1° of a cell edge is handled the same way).
- Rain quality control removes implausible spells. The demo record contains a 516 mm spell in June 2020 (a month that normally gets ~1 mm), and the removal is shown in the UI, not done silently.

## Code map

| Path | What |
|---|---|
| [src/engine/](src/engine/) | Framework-free TypeScript engine. Public API in [index.ts](src/engine/index.ts) |
| [src/engine/weather.ts](src/engine/weather.ts) | POWER parsing, cell blending, rain QC, scenario shifts |
| [src/engine/simulate.ts](src/engine/simulate.ts) | Daily crop simulation (water balance, salinity, frost, heat, erosion) |
| [src/engine/rotation.ts](src/engine/rotation.ts) | Agronomic rules, pest/disease analysis, history replay |
| [src/engine/score.ts](src/engine/score.ts) | Priority weighting, candidate generation |
| [src/engine/explain.ts](src/engine/explain.ts) | Strategy cards from numbers |
| [src/tool/](src/tool/) | React UI: inputs, climate panel, rotation calendar, trade-off table, cards |
| [scripts/build-demo-data.mjs](scripts/build-demo-data.mjs) | Builds `public/data/maneadero-demo.json` |

## For teammates (map, 3D, landing page)

```ts
import { loadFieldData, runEngine, DEFAULT_FIELD, DEFAULT_PRIORITIES, DEFAULT_SCENARIO, DEFAULT_CURRENT } from './engine'

const data = await loadFieldData(lat, lon)            // or loadDemoData()
const result = runEngine({ data, field: { ...DEFAULT_FIELD, lat, lon }, scenario: DEFAULT_SCENARIO,
                           priorities: DEFAULT_PRIORITIES, current: DEFAULT_CURRENT })
result.strategies   // [current, small-change, best, different]: windows, metrics, scores, card
result.features     // monthly climate, frost/heat/dry-year stats
```

- The landing's **"3d visual"** button opens the planner (`#3d-visual`, also `#planner`), routed in [src/App.tsx](src/App.tsx). `<Planner onHome />` from [src/tool/Planner.tsx](src/tool/Planner.tsx) runs map → loading → results, and its paper "back" button returns to the landing.
- The planner reuses the landing's logo and "back" button and its palette (sage `#dfe9e3`, navy `#24425a`, green `#2a6b2f`), with Gaegu (handwritten) headings and Nunito body text. Chart colors are the validated data palette.
- `loadFieldData(lat, lon, { onStep })` reports `'weather'` / `'soil'` steps for custom loading screens.
- For the 3D erosion view, `strategy.metrics.erosionT` and `bareRainyDays` compare rotations, and `soil.kFactor` plus the field slope give the RUSLE inputs.

## Known limits (also shown in the app)
- POWER cells are ~50 km; winter nights in the blend are milder than the valley floor. Compare with a local station.
- Income is a relative placeholder index (`marketIndex` in crops.ts). Replace it with local prices.
- SoilGrids is often slow: each request is capped at 8 s with one retry, then the default valley soil is used and the app says so.
- The satellite "bare / green" tag is a visible-band greenness index on one image per year, not a full NDVI time series.
- Not yet integrated: SMAP soil moisture, NDVI time series, SRTM slope, GRACE groundwater trend.

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
npm run serve        # production build + preview server (includes the agent endpoint)
```

For the planning agent, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. The key is read only by the local server and never reaches the browser. Without it, the rest of the app works and the agent panel says it isn't set up.

## Planning agent: "Ask about your plan"

A chat drawer on the results screen where the farmer talks through their options in Spanish or English: "¿Por qué esta opción?", "What if I keep tomato every year?", "¿Qué hago este otoño?", "What could go wrong?".

**How it's built**
- `server/agentPlugin.ts` adds `POST /api/agent` to the Vite dev and preview servers. It holds the key and fixes the model (`claude-opus-5-5`, effort `medium`), the system prompt, the tools and size limits. The browser can only send conversation turns (user/assistant), and responses stream back as Server-Sent Events. Refusals fall back to another model server-side (`fallbacks: "default"`), and the fixed prompt and tools are prompt-cached.
- The loop runs in the browser ([useAgent.ts](src/agent/useAgent.ts)) because the tools need the engine state there. Each tool call runs against the engine in a separate worker ([toolHandlers.ts](src/agent/toolHandlers.ts)). There are at most 8 tool rounds per question, and history is rolled back if a question fails half-way.
- 9 tools ([toolDefs.ts](src/agent/toolDefs.ts)): `get_field_overview`, `get_options`, `evaluate_rotation` (what-if), `compare_rotations`, `test_climate`, `crop_info`, `season_plan`, `show_on_land` (drives the 3D view) and `propose_change`.

**Changing a plan together**
- The farmer picks any plan on the card (or the helper is asked to "Review this plan"). Every question carries an app note saying which plan is open, the drawer shows "Talking about: …" and each question is tagged with the plan it was about.
- The helper can only change a plan through `propose_change`. The app replays the changed rotation and shows a card in the chat with the seasons that change, water / money / soil versus the plan before, and any rule problems, plus **Allow** and **Deny**. The loop waits for the farmer; Stop counts as Deny.
- An allowed change becomes **Your plan**, a fifth tile on the card ("Edited from …", with an "Undo my changes" link). It is replayed again when the field, climate or priorities change, and the helper can keep editing it.

**How it stays grounded**
1. Data only comes from tools. The system prompt ([systemPrompt.ts](src/agent/systemPrompt.ts)) forbids figures that aren't in a tool result and sends pesticides, diagnosis, prices, credit and legal questions to the agronomist.
2. Code does the math: tools return rounded figures and precomputed % changes and differences, so the model only quotes them.
3. Inputs are constrained: strict schemas with crop-id enums, re-validated in the browser. Bad input comes back as an error result instead of running.
4. Every answer gets a unit-aware number check ([grounding.ts](src/agent/grounding.ts)): numbers not found in this conversation's tool results (with the same unit) are underlined and counted under the answer.
5. Transparency: each answer has a "What I checked" step list and its data sources.

**Limits:** it needs internet and a key, and costs per question (2–5 API calls; the server logs token use per call). It only knows what the engine knows (coarse NASA grid, modeled soil, placeholder income index, no sensors yet). The conversation is lost on refresh and there's a single user. The number check verifies figures, not every sentence. The server has no auth, so run it locally only.

## The farmer's flow

1. **Landing → "3d visual"** opens the planner.
2. **Pick the field on a map** and press **Set location**.
3. **"What are you planting now?"** The farmer types crop names (English or Spanish); matches appear after a 1-second pause. They only say *which* crops they grow; the tool works out the seasons ([CropPicker.tsx](src/tool/CropPicker.tsx)).
4. **"Analyzing your farm…"**: a Landsat timelapse of the spot from 1995 to today plays once, in order, while the engine runs.
5. **Results, kept simple**: a **3D model of 6 × 6 km of land around the field** (NASA SRTM elevation with a satellite photo on top) with three layers: *soil washing away* (the selected option's modeled soil loss spread over the land by slope), *where water runs* (D8 flow paths) and *just the photo*. Next to it is one card: "What matters most to you?" tiles along its top (they re-rank the options) and the plans down its right side (*What you do now*, *A small change*, *Best for you*, *Another way*, and *Your plan* once the farmer allows a change), with a 3-year ring and "uses X% less water / earns Y% less / protects the soil better". **See all the details** opens the full report (climate, Landsat filmstrip, calendar, trade-off table, evidence cards, method).

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

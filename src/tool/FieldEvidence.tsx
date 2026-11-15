import type { ReactNode } from 'react'
import { CROP_BY_ID, type EngineResult, type FieldInput } from '../engine'
import {
  capacityName,
  clock,
  daylightEtShare,
  mlPerMm,
  NASA_NIGHT_ET0,
  NODE_SITE,
  POT_CAPACITY_RANGE,
  siteVolumeL,
  type GroundSummary,
} from '../engine/ground'
import { Badge } from './ClimatePanel'
import { fmt, MONTHS } from './format'
import { RECORDINGS, useRecordingSummaries } from './useGround'

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
type P = 'observed' | 'modeled' | 'assumed'

function Stat(props: { label: string; value: string; sub?: string; p: P }) {
  return (
    <div className="tile">
      <div className="tile-label">
        {props.label} <Badge p={props.p} />
      </div>
      <div className="tile-value">{props.value}</div>
      {props.sub && <div className="tile-sub">{props.sub}</div>}
    </div>
  )
}

function Window(props: { title: string; kicker: string; children: ReactNode }) {
  return (
    <article className="ev-window">
      <span className="ev-kicker">{props.kicker}</span>
      <h3>{props.title}</h3>
      {props.children}
    </article>
  )
}

/** Night run: the drainage equation, checked three ways and against NASA (analysis/verify_de.py). */
function DrainageWindow({ g }: { g: GroundSummary }) {
  const fit = g.fit
  if (!fit) return null
  const site = NODE_SITE
  const k = -1 / fit.tauH
  const leftAfterDay = Math.exp(-24 / fit.tauH) * 100
  const dropRaw = g.peakRaw - g.rawEnd
  const vol = siteVolumeL(site)
  const [lo, hi] = POT_CAPACITY_RANGE.map((cc) => ((cc * dropRaw) / fit.fcRaw) * vol * 1000)
  const nasaMl = NASA_NIGHT_ET0.maxMm * mlPerMm(site)
  return (
    <Window kicker={`Night run · ${clock(g.peakMs)}–${clock(g.endMs)}`} title="Drainage: how fast water leaves the soil">
      <p className="ev-eq">
        dm/dt = k·(m − m∞) &nbsp;→&nbsp; k = {fmt(k, 3)} per hour, m∞ = {fmt(fit.fcRaw)}
      </p>
      <div className="tiles">
        <Stat label="Half-life of extra water" value={`${fmt(fit.tauH * Math.LN2, 1)} h`} sub={`τ = ${fmt(fit.tauH, 2)} h · fit error ${fmt(fit.rmse, 1)}`} p="observed" />
        <Stat label={capacityName(site).replace(/^./, (ch) => ch.toUpperCase())} value={`${fmt((fit.fcRaw / g.peakRaw) * 100)}% of peak`} sub={`settles at reading ${fmt(fit.fcRaw)}`} p="observed" />
        <Stat label="Drained overnight" value={`${fmt(Math.round(lo / 10) * 10)}–${fmt(Math.round(hi / 10) * 10)} mL`} sub={`from the ${fmt(vol, 1)} L pot (water content assumed)`} p="assumed" />
        <Stat label="NASA night evaporation" value={`≤ ${fmt(nasaMl)} mL`} sub={`≤ ${NASA_NIGHT_ET0.maxMm} mm · explains ≤ 1% of the loss`} p="modeled" />
      </div>
      <ul className="ev-list small">
        <li>
          <strong>NASA doesn't see drainage.</strong> NASA POWER only describes the air; the night loss was water draining through the pot, not
          evaporating.
        </li>
        <li>
          <strong>Checks a model assumption.</strong> After 24 h only {fmt(leftAfterDay, 1)}% of the extra water is left, so the crop simulation's
          "drains the same day" rule holds for this soil. A clay soil would drain over days and break it.
        </li>
        <li>
          <strong>Verified three ways:</strong> curve fit k = {fmt(k, 3)}/h, rates from the data k = −0.219/h, straight-line check τ = 4.55 h; it beats
          simpler models decisively (AIC 472 vs 1365).
        </li>
      </ul>
    </Window>
  )
}

/** Sun run: NASA's expected evaporation for the same hours vs what the probe could resolve. */
function EvaporationWindow({ g, et0Day, monthName }: { g: GroundSummary; et0Day: number; monthName: string }) {
  const site = NODE_SITE
  const tr = g.trend
  const share = daylightEtShare(g.peakMs, g.endMs, site.lat, site.lon)
  const kc = CROP_BY_ID[site.cropId]?.kc[1] ?? 1
  const mm = et0Day * share * kc
  const ml = mm * mlPerMm(site)
  const toPct = (raw: number) => (raw / g.peakRaw) * 100
  const detectable = !!tr && Math.abs(tr.slopePerH) > 2 * tr.sePerH
  return (
    <Window kicker={`Sun run · ${clock(g.peakMs)}–${clock(g.endMs)}`} title="Soil evaporation in the sun">
      <p className="ev-eq">expected loss = ET₀ × share of the day × Kc = {fmt(et0Day, 1)} × {fmt(share * 100)}% × {fmt(kc, 1)} = {fmt(mm, 2)} mm</p>
      <div className="tiles">
        <Stat label="NASA water demand" value={`${fmt(et0Day, 1)} mm/day`} sub={`typical ${monthName} ET₀`} p="modeled" />
        <Stat label="Expected in this window" value={`${fmt(ml)} mL`} sub={`${fmt(mm, 2)} mm from this pot`} p="modeled" />
        {tr && (
          <Stat
            label="Measured trend"
            value={`${fmt(toPct(tr.slopePerH), 1)} ± ${fmt(toPct(2 * tr.sePerH), 1)}%/h`}
            sub={detectable ? 'drying measurable' : `within the ${fmt(toPct(tr.sdRaw), 1)}% scatter`}
            p="observed"
          />
        )}
      </div>
      <ul className="ev-list small">
        <li>
          <strong>{detectable ? 'The sun-drying shows up.' : 'Too short to see the sun dry the pot.'}</strong> The expected change (~{fmt(ml)} mL in{' '}
          {fmt(siteVolumeL(site), 1)} L of soil) is smaller than the scatter between single readings. The firmware now logs the average of 48 readings per
          row to cut that scatter.
        </li>
        <li>
          <strong>Sun warms the probe.</strong> It reads about 2% higher per °C, so the morning rise (+3%) was probably heat, not water.
        </li>
        <li>
          <strong>Best measurement:</strong> weigh the pot before and after (1 g = 1 mL; {fmt(mlPerMm(site))} mL = 1 mm). Measured mm ÷ (ET₀ × share)
          gives basil's real crop coefficient. The engine's Kc for basil is estimated from other herbs.
        </li>
      </ul>
    </Window>
  )
}
/** How many days the soil carries the crop between waterings, from NASA ET₀ and the soil data. */
function WateringWindow({ result, field, cropId }: { result: EngineResult; field: FieldInput; cropId: string }) {
  const c = CROP_BY_ID[cropId]
  if (!c) return null
  const soil = result.soil
  const months = result.features.monthly
  const taw = soil.awcMmPerM * c.rootDepthM
  const raw = c.p * taw
  const kcMid = c.kc[1]
  const peakM = months.reduce((bi, m, i) => (m.et0MeanMm > months[bi].et0MeanMm ? i : bi), 0)
  const etc = (m: number) => (kcMid * months[m].et0MeanMm) / DAYS_IN_MONTH[m]
  const nowM = 10
  const daysNow = raw / etc(nowM)
  const daysPeak = raw / etc(peakM)
  const sens = (0.02 / (soil.thetaFC - soil.thetaWP)) * 100
  const gross = raw / Math.max(0.3, field.irrigationEfficiency)
  const name = c.name.replace(/ \(.*\)$/, '')
  return (
    <Window kicker={`${name} in your field · NASA ET₀ + SoilGrids`} title="Watering window">
      <p className="ev-eq">
        days between waterings = RAW ÷ ETc = (p × TAW) ÷ (Kc × ET₀) = {fmt(c.p, 2)} × {fmt(taw)} mm ÷ ETc
      </p>
      <div className="tiles">
        <Stat label={`${MONTHS[nowM]} window`} value={`${fmt(daysNow)} days`} sub={`ETc ${fmt(etc(nowM), 1)} mm/day`} p="modeled" />
        <Stat label={`${MONTHS[peakM]} window`} value={`${fmt(daysPeak)} days`} sub={`peak demand, ETc ${fmt(etc(peakM), 1)} mm/day`} p="modeled" />
        <Stat label="Water per watering" value={`${fmt(raw)} mm`} sub={`${fmt(gross)} mm gross at ${fmt(field.irrigationEfficiency * 100)}% efficiency`} p="modeled" />
        <Stat label="If field capacity is off by 0.02" value={`± ${fmt(sens)}%`} sub="change in every window above" p="assumed" />
      </div>
      <ul className="ev-list small">
        <li>
          <strong>Where the sensor helps:</strong> field capacity sets TAW, and a 0.02 error moves every window by {fmt(sens)}%. A probe in the field,
          drained like our night run and calibrated, replaces the SoilGrids estimate.
        </li>
        <li>
          <strong>Water lost when watering</strong> is the {fmt(100 - field.irrigationEfficiency * 100)}% the model assumes. Water 20 mm, log the
          peak and drainage, and efficiency ≈ (applied − drained) ÷ applied becomes a measured number.
        </li>
      </ul>
    </Window>
  )
}

type Status = 'measured' | 'test ready' | 'add sensor'
const STATUS: { item: string; before: string; now: string; s: Status }[] = [
  { item: 'Drainage speed', before: 'assumed instant', now: 'measured: half-life 3.2 h, same-day rule confirmed', s: 'measured' },
  { item: 'Holding capacity', before: 'SoilGrids estimate', now: 'measured in the pot (82% of peak); field needs a field probe', s: 'measured' },
  { item: 'Night vs day loss', before: 'not separated', now: 'night = drainage (NASA ≤ 1%), day = evaporation', s: 'measured' },
  { item: 'Weather cell', before: 'Maneadero cell', now: 'Ensenada pot uses its own NASA cell (220 m, nights 1–2 °C cooler)', s: 'measured' },
  { item: 'Basil water use (Kc)', before: 'estimated from herbs', now: 'weigh the pot over one day', s: 'test ready' },
  { item: 'Watering losses', before: 'assumed by system type', now: '20 mm watering test with the probe', s: 'test ready' },
  { item: 'Probe → water content', before: 'assumed linear', now: 'weigh and dry 3–4 soil samples', s: 'test ready' },
  { item: 'Local temperature / frost', before: 'NASA grid only', now: 'a temperature sensor (≈ $2) measures it on site', s: 'add sensor' },
  { item: 'Sun-warming of the probe', before: 'uncorrected', now: 'a soil thermometer corrects the readings', s: 'add sensor' },
]

/** Ground-truth windows: what the field node measured and how it sharpens the NASA-based numbers. */
export function FieldEvidence({ result, field }: { result: EngineResult; field: FieldInput }) {
  const [night, sun] = useRecordingSummaries()
  const nov = 10
  const et0Day = result.features.monthly[nov].et0MeanMm / DAYS_IN_MONTH[nov]
  const cropId = CROP_BY_ID[NODE_SITE.cropId] ? NODE_SITE.cropId : result.strategies[0]?.rotation.slots.find(Boolean) ?? ''
  return (
    <section className="card field-evidence">
      <div className="card-head">
        <h2>Ground truth from the field node</h2>
        <span className="muted small">
          Arduino Nano soil probe in a basil pot, Ensenada · {RECORDINGS.map((r) => r.label).join(' and ')} · checked against NASA POWER
        </span>
      </div>
      <div className="ev-grid">
        {night ? <DrainageWindow g={night} /> : <p className="small muted">Loading the night run…</p>}
        {sun ? <EvaporationWindow g={sun} et0Day={et0Day} monthName={MONTHS[nov]} /> : <p className="small muted">Loading the sun run…</p>}
        <WateringWindow result={result} field={field} cropId={cropId} />
        <Window kicker="Data accuracy" title="What the sensor turns from assumed into measured">
          <ul className="ev-status small">
            {STATUS.map((x) => (
              <li key={x.item}>
                <span className={`ev-chip ev-${x.s.replace(' ', '-')}`}>{x.s}</span>
                <span>
                  <strong>{x.item}</strong> · was {x.before} → {x.now}
                </span>
              </li>
            ))}
          </ul>
        </Window>
      </div>
    </section>
  )
}

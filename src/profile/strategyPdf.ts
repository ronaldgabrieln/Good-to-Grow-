// A PDF report of one strategy, for the farmer to send to an agronomist or extension agent.
// Built in the browser with jsPDF (loaded only when a PDF is asked for); nothing leaves the device.
import type { jsPDF as JsPDF } from 'jspdf'
import { CROP_BY_ID, PRIORITY_KEYS, PRIORITY_LABELS, SOURCES, windowsOf, type RotationMetrics } from '../engine'
import type { SavedStrategyPayload } from './types'

const SEASONS = ['Year 1 spring', 'Year 1 fall', 'Year 2 spring', 'Year 2 fall', 'Year 3 spring', 'Year 3 fall']
const INK: [number, number, number] = [36, 66, 90]
const MUTED: [number, number, number] = [110, 124, 134]
const GREEN: [number, number, number] = [42, 107, 47]
const KIND_FILL: Record<string, [number, number, number]> = { cash: [42, 120, 214], cover: [27, 175, 122], forage: [237, 161, 0] }
const KIND_NAME: Record<string, string> = { cash: 'Cash crop', cover: 'Cover crop', forage: 'Forage' }

// The built-in PDF fonts only cover Windows-1252: map the symbols the app uses, drop anything else.
const WIN_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
const SWAP: Record<string, string> = { '→': '->', '←': '<-', '₀': '0', '₂': '2', '≥': '>=', '≤': '<=', '≈': '~', '▲': '+', '▼': '-', '−': '-', '✓': 'OK', '⚠': '!', ' ': ' ' }
export function pdfText(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (SWAP[ch] !== undefined) out += SWAP[ch]
    else if ((c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff) || WIN_EXTRA.has(ch) || ch === '\n') out += ch
  }
  return out
}

const n = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '-')
const pct = (a: number, b: number) => (b === 0 ? null : ((a - b) / Math.abs(b)) * 100)
const cropName = (id: string | null) => (id ? (CROP_BY_ID[id]?.name.replace(/ \(.*\)$/, '') ?? id) : 'Nothing planted')

/** Rows of [measure, this plan, current rotation, change, good direction]. */
function metricRows(m: RotationMetrics, b: RotationMetrics | null) {
  const rows: [string, number, number | null, number, 'down' | 'up'][] = [
    ['Irrigation (mm per year)', m.waterMm, b?.waterMm ?? null, 0, 'down'],
    ['Irrigation in the driest 10% of replays (mm/yr)', m.waterDryYearMm, b?.waterDryYearMm ?? null, 0, 'down'],
    ['Income index (relative, not money)', m.income, b?.income ?? null, 1, 'up'],
    ['Income index in the worst 10% of replays', m.incomeLowYear, b?.incomeLowYear ?? null, 1, 'up'],
    ['Nitrogen fertilizer to buy (kg/ha/yr)', m.nitrogenKg, b?.nitrogenKg ?? null, 0, 'down'],
    ['Soil lost to erosion (t/ha/yr)', m.erosionT, b?.erosionT ?? null, 2, 'down'],
    ['Bare days in the rainy season (per yr)', m.bareRainyDays, b?.bareRainyDays ?? null, 0, 'down'],
    ['Soil carbon added from residue (t C/ha/yr)', m.soilCarbon, b?.soilCarbon ?? null, 2, 'up'],
    ['Pest & disease break score (0-100)', m.pestScore, b?.pestScore ?? null, 0, 'up'],
    ['Replays with a failed crop (%)', m.failureRisk * 100, b ? b.failureRisk * 100 : null, 0, 'down'],
  ]
  return rows.map(([label, v, base, d, good]) => {
    const p = base === null ? null : pct(v, base)
    const change = base === null ? '' : p === null || Math.abs(v - base) < 1e-9 ? 'same' : `${p > 0 ? '+' : ''}${n(p)}%`
    const better = base === null || p === null || Math.abs(p) < 3 ? '' : (good === 'down' ? p < 0 : p > 0) ? 'better' : 'worse'
    return [label, n(v, d), base === null ? '-' : n(base, d), change ? `${change}${better ? ` (${better})` : ''}` : '']
  })
}

export async function downloadStrategyPdf(p: SavedStrategyPayload, opts: { title: string; username?: string | null }): Promise<void> {
  const doc = await buildStrategyPdf(p, opts)
  const safe = opts.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'plan'
  doc.save(`GoodToGrow-${safe}.pdf`)
}

export async function buildStrategyPdf(p: SavedStrategyPayload, opts: { title: string; username?: string | null }): Promise<JsPDF> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 16
  const CW = W - 2 * M
  let y = M

  const ensure = (h: number) => {
    if (y + h > H - 18) {
      doc.addPage()
      y = M
    }
  }
  const text = (s: string, size: number, opt: { bold?: boolean; color?: [number, number, number]; gap?: number } = {}) => {
    doc.setFont('helvetica', opt.bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...(opt.color ?? INK))
    const lines = doc.splitTextToSize(pdfText(s), CW) as string[]
    const lh = size * 0.42
    ensure(lines.length * lh)
    doc.text(lines, M, y + size * 0.32)
    y += lines.length * lh + (opt.gap ?? 1.5)
  }
  const heading = (s: string) => {
    ensure(34) // keep a heading with at least a few lines of what follows
    y += 3
    text(s, 13, { bold: true, color: GREEN, gap: 2 })
  }
  const bullets = (title: string, items: string[]) => {
    if (!items.length) return
    text(title, 10.5, { bold: true, gap: 1 })
    for (const it of items) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.5)
      const lines = doc.splitTextToSize(pdfText(it), CW - 5) as string[]
      ensure(lines.length * 4)
      doc.setTextColor(...INK)
      doc.text('•', M + 1, y + 3)
      doc.text(lines, M + 5, y + 3)
      y += lines.length * 4 + 0.8
    }
    y += 2
  }
  const table = (head: string[] | null, body: string[][], colWidths?: number[]) => {
    autoTable(doc, {
      startY: y,
      head: head ? [head.map(pdfText)] : undefined,
      showHead: head ? 'everyPage' : 'never',
      body: body.map((r) => r.map(pdfText)),
      margin: { left: M, right: M },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.8, textColor: INK, lineColor: [226, 221, 207], lineWidth: 0.2 },
      headStyles: { fillColor: [241, 238, 229], textColor: INK, fontStyle: 'bold' },
      columnStyles: colWidths ? Object.fromEntries(colWidths.map((w, i) => [i, { cellWidth: w }])) : undefined,
      theme: 'grid',
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4
  }

  // ── Header
  const saved = new Date(p.savedAt).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  text('GOODTOGROW · CROP ROTATION PLAN', 9, { bold: true, color: GREEN, gap: 2 })
  text(opts.title, 18, { bold: true, gap: 2 })
  text(`${p.field.name} (${n(p.field.lat, 4)}, ${n(p.field.lon, 4)}) · saved ${saved}${opts.username ? ` by ${opts.username}` : ''}`, 9.5, { color: MUTED, gap: 1 })
  text('Prepared for review with an agronomist or extension agent. All figures are modeled from 30 years of NASA weather for this point; they are a guide, not a guarantee.', 9.5, { color: MUTED, gap: 3 })

  // ── The plan
  heading(`The plan: ${p.plan.title}`)
  text(p.plan.label || 'Nothing planted', 11, { bold: true, gap: 2 })
  if (p.plan.fromTitle) text(`Edited by the farmer from "${p.plan.fromTitle}"${p.plan.edits?.length ? `: ${p.plan.edits.join('; ')}` : ''}.`, 9.5, { gap: 2 })

  // 3-year timeline of plantings.
  ensure(30)
  const tlY = y + 2
  const barH = 12
  const dayW = CW / (3 * 365)
  doc.setDrawColor(226, 221, 207)
  doc.setFillColor(247, 245, 238)
  doc.rect(M, tlY, CW, barH, 'FD')
  for (const w of windowsOf(p.plan.slots)) {
    const c = CROP_BY_ID[w.cropId]
    const fill = KIND_FILL[c.kind] ?? INK
    const segs: [number, number][] = w.endDay <= 3 * 365 ? [[w.startDay, w.endDay]] : [[w.startDay, 3 * 365], [0, w.endDay - 3 * 365]]
    for (const [a, b] of segs) {
      doc.setFillColor(...fill)
      doc.rect(M + a * dayW, tlY + 0.6, Math.max(0.5, (b - a) * dayW - 0.6), barH - 1.2, 'F')
      const segW = (b - a) * dayW
      if (segW > 7) {
        // Two short lines inside the bar, e.g. "Green" / "onion"; long names are cut to fit.
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(6.5)
        doc.setTextColor(255, 255, 255)
        const name = pdfText(cropName(w.cropId))
        const fits = name.split(/\s+/).every((word) => doc.getTextWidth(word) <= segW - 1.6)
        const lines = (doc.splitTextToSize(name, segW - 1.6) as string[]).slice(0, 2)
        if (fits) doc.text(lines, M + a * dayW + 0.9, tlY + (lines.length > 1 ? 4.6 : 7))
      }
    }
  }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...MUTED)
  for (let yr = 0; yr < 3; yr++) {
    for (const [mo, lab] of [[0, 'Jan'], [181, 'Jul']] as const) {
      const x = M + (yr * 365 + mo) * dayW
      doc.line(x, tlY + barH, x, tlY + barH + 1.5)
      doc.text(mo === 0 ? `Year ${yr + 1} · ${lab}` : lab, x + 0.8, tlY + barH + 4.5)
    }
  }
  let lx = M
  for (const k of ['cash', 'cover', 'forage']) {
    doc.setFillColor(...KIND_FILL[k])
    doc.rect(lx, tlY + barH + 7, 3, 3, 'F')
    doc.text(KIND_NAME[k], lx + 4.2, tlY + barH + 9.6)
    lx += 28
  }
  y = tlY + barH + 15

  table(['Season', 'Crop', 'Type'], p.plan.slots.map((id, i) => [SEASONS[i], cropName(id), id ? (KIND_NAME[CROP_BY_ID[id]?.kind] ?? '') : '']), [40, 90, CW - 130])
  if (p.plan.problems.length) bullets('Rule warnings', p.plan.problems)

  // ── Figures
  heading(p.plan.baseMetrics ? 'What it means, compared with what you plant now' : 'What it means')
  if (p.plan.baseMetrics) text(`Current rotation: ${p.current.map(cropName).join(' -> ')}`, 9, { color: MUTED, gap: 2 })
  const rows = metricRows(p.plan.metrics, p.plan.baseMetrics)
  table(
    p.plan.baseMetrics ? ['Measure', 'This plan', 'Current', 'Change'] : ['Measure', 'This plan', '', ''],
    rows,
    [78, 28, 28, CW - 134],
  )
  text(`Every figure is the average of ${p.plan.metrics.cyclesReplayed} replays: the rotation started in each year of the weather record and grown day by day. Irrigation: 1 mm = 10 m³ per hectare. The income index is a placeholder per crop, not prices.`, 8.5, { color: MUTED, gap: 2 })

  // ── Explanation
  const c = p.plan.card
  if (c) {
    heading('Why this plan')
    if (c.headline) text(c.headline, 10.5, { bold: true, gap: 2 })
    bullets('Why it was suggested', c.why)
    bullets('Benefits', c.benefits)
    bullets('Trade-offs', c.tradeoffs)
    bullets('Risks found in the replay', c.risks)
    bullets('Information gaps', c.gaps)
    if (c.extension) bullets('Talk to your agronomist about', [c.extension])
  }

  // ── Field and inputs
  heading('The field and the inputs used')
  const s = p.soil
  const cl = p.climate
  const f = p.field
  table(null, [
    ['Location', `${f.name}, ${n(f.lat, 4)}, ${n(f.lon, 4)}`],
    ['Elevation / slope', `${n(f.elevationM)} m / ${n(f.slopePct, 1)}% over ${n(f.slopeLengthM)} m`],
    ['Well water salinity', `${n(f.wellEcDsM, 1)} dS/m`],
    ['Irrigation efficiency', `${n(f.irrigationEfficiency * 100)}%`],
    ['Soil (0-30 cm)', `${s.texture}, ${n(s.sandPct)}% sand, ${n(s.clayPct)}% clay, organic carbon ${n(s.socGkg, 1)} g/kg, pH ${n(s.ph, 1)}, holds ${n(s.awcMmPerM)} mm water per m (${s.source === 'soilgrids' ? 'SoilGrids model' : 'default valley soil'})`],
    ['Climate ' + cl.years, `median rain ${n(cl.rainMedianMm)} mm/yr (dry years ${n(cl.rainDryYearsMm)} mm), crop water demand ET0 ${n(cl.et0AnnualMm)} mm/yr, ${cl.dryYears} very dry years, frost in ${cl.frostYears} of ${cl.nYears} years`],
    ['Climate test applied', p.scenario.deltaTempC || p.scenario.rainChange ? `+${n(p.scenario.deltaTempC, 1)} °C, ${p.scenario.rainChange >= 0 ? '+' : ''}${n(p.scenario.rainChange * 100)}% rain` : 'none (observed climate)'],
    ['Priorities (0-5)', PRIORITY_KEYS.map((k) => `${PRIORITY_LABELS[k]} ${p.priorities[k]}`).join(' · ')],
    ['Data', `weather: ${p.data.weatherSource}; ${n(p.data.rotationsReplayed)} rotations compared`],
  ].map(([a, b]) => [a, b]), [42, CW - 42])
  if (p.data.notes.length) bullets('Data notes', p.data.notes)

  // ── Method
  heading('How this was made')
  bullets('Method', [
    'Daily NASA POWER weather for this point (1995-2024) is turned into crop water demand with FAO-56 Penman-Monteith.',
    'Each crop is grown day by day in every historical year with a soil-water balance using this soil, the well salinity and the irrigation system.',
    'Thousands of valid 3-year rotations are replayed through every start year and scored on water, income, soil, nitrogen, erosion, pests and weather risk.',
  ])
  bullets('Sources', Object.values(SOURCES))
  text('This report supports, and does not replace, the judgment of the farmer and a local agronomist. Numbers come from coarse global datasets (about 50 km weather cells, 250 m soil maps) and should be checked against local measurements.', 8.5, { color: MUTED })

  // ── Footer on every page
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(pdfText(`GoodToGrow · ${opts.title}`).slice(0, 90), M, H - 8)
    doc.text(`Page ${i} of ${pages}`, W - M, H - 8, { align: 'right' })
  }
  return doc
}

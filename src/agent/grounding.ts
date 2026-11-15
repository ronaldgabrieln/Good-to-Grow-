// Number check for agent answers: every figure in an answer should appear in a tool result from
// this conversation. Tool results feed a ledger of (value, unit) pairs; each number in the answer
// is looked up at the precision the answer used ("28%" matches 27.6) and, when the answer gives a
// unit, only against figures with the same unit ("42 t" must match a tonnes figure, not a 42 that
// happens to be a percentage). Units come from the tool's JSON key names (…_pct, …_mm, …_t_per…)
// or from the words next to a number. Unmatched numbers are marked in the UI. This verifies
// figures, not every qualitative claim.

export type Unit = 'pct' | 'mm' | 'm3' | 't' | 'kg' | 'days' | 'c' | 'score'
export interface LedgerEntry {
  value: number
  unit: Unit | null
}
export type Ledger = LedgerEntry[]

const NUMBER_IN_TEXT = /-?\d[\d,]*(?:\.\d+)?/g

/** Unit written right after a number, in English or Spanish. */
const UNIT_AFTER: [Unit, RegExp][] = [
  ['pct', /^\s?(%|por ?ciento|percent)/i],
  ['m3', /^\s?(m³|m3|metros? c[uú]bicos?|cubic met)/i],
  ['mm', /^\s?mm\b/i],
  ['kg', /^\s?kg\b/i],
  ['t', /^\s?(t\b|tons?\b|toneladas?\b|tonnes?\b)/i],
  ['days', /^\s?(d[ií]as?|days?)\b/i],
  ['c', /^\s?(°\s?c\b|°|grados)/i],
  ['score', /^\s?(\/\s?100|de 100|out of 100)/i],
]

export function unitAfter(text: string): Unit | null {
  const head = text.slice(0, 20)
  for (const [unit, re] of UNIT_AFTER) if (re.test(head)) return unit
  return null
}

/** Unit implied by a tool-result key such as irrigation_change_pct or soil_loss_t_per_hectare_per_year. */
export function unitFromKey(key: string): Unit | null {
  const k = key.toLowerCase()
  if (/pct|percent/.test(k)) return 'pct'
  if (/m3/.test(k)) return 'm3'
  if (/(^|_)mm(_|$)/.test(k)) return 'mm'
  if (/(^|_)kg(_|$)/.test(k)) return 'kg'
  if (/(^|_)t(_|$)/.test(k)) return 't'
  if (/days?(_|$)/.test(k)) return 'days'
  if (/(^|_)c$|_c_|temperature/.test(k)) return 'c'
  if (/score|out_of_100/.test(k)) return 'score'
  return null
}

/** Parse a number written in English or Spanish style ("1,234", "1,5", "12.5"). */
export function parseNumber(raw: string): { value: number; decimals: number } | null {
  let s = raw
  // "1,5" or "12,75" (no further digits) reads as a Spanish decimal; "1,234" as a thousands separator.
  if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.')
  else s = s.replace(/,/g, '')
  const value = Number(s)
  if (!Number.isFinite(value)) return null
  const dot = s.indexOf('.')
  return { value, decimals: dot < 0 ? 0 : s.length - dot - 1 }
}

/** Collect every number from a tool result, with the unit its key or neighbouring words give it. */
export function addToLedger(ledger: Ledger, toolResultJson: string) {
  const walk = (v: unknown, unit: Unit | null) => {
    if (typeof v === 'number' && Number.isFinite(v)) ledger.push({ value: v, unit })
    else if (typeof v === 'string') {
      for (const m of v.matchAll(NUMBER_IN_TEXT)) {
        const p = parseNumber(m[0])
        if (p) ledger.push({ value: p.value, unit: unitAfter(v.slice((m.index ?? 0) + m[0].length)) ?? unit })
      }
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, unit))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, unitFromKey(k) ?? unit)
  }
  try {
    walk(JSON.parse(toolResultJson), null)
  } catch {
    walk(toolResultJson, null)
  }
}

function matches(ledger: Ledger, n: { value: number; decimals: number }, unit: Unit | null) {
  const step = 10 ** -n.decimals
  const target = Math.abs(n.value)
  return ledger.some((e) => {
    if (unit && e.unit !== unit) return false
    const a = Math.abs(e.value)
    // Same number at the precision the answer used (rounded or truncated).
    return Math.abs(a - target) <= step / 2 + 1e-9 || Math.abs(Math.trunc(a / step) * step - target) < 1e-9
  })
}

export interface CheckedSegment {
  text: string
  /** Set on number segments: true when found in the ledger. */
  verified?: boolean
}

export interface GroundingReport {
  segments: CheckedSegment[]
  checked: number
  unverified: string[]
}

/**
 * Split an answer into text and number segments and check each number. Small unitless counts
 * (0-12: "3 years", "2 options") and years mentioned in the data are not counted, since they
 * carry little risk and would make the check noisy.
 */
export function checkAnswer(text: string, ledger: Ledger): GroundingReport {
  const segments: CheckedSegment[] = []
  const unverified: string[] = []
  let checked = 0
  let last = 0
  for (const m of text.matchAll(NUMBER_IN_TEXT)) {
    const raw = m[0].replace(/,$/, '')
    const start = m.index ?? 0
    const p = parseNumber(raw)
    // Skip parts of words or ids ("Y1", "co2").
    const prev = text[start - 1] ?? ' '
    if (!p || /[A-Za-z_]/.test(prev)) continue
    const unit = unitAfter(text.slice(start + raw.length))
    const small = p.decimals === 0 && Math.abs(p.value) <= 12 && (unit === null || unit === 'days')
    // The "100" in "93 out of 100" / "93 de 100" / "93/100" is the scale, not a claim.
    const scale = p.value === 100 && /(out of|de|\/)\s*$/i.test(text.slice(Math.max(0, start - 8), start))
    const year = p.decimals === 0 && p.value >= 1980 && p.value <= 2040 && unit === null && ledger.some((e) => e.value === p.value)
    if (start > last) segments.push({ text: text.slice(last, start) })
    if (small || year || scale) {
      segments.push({ text: raw })
    } else {
      checked++
      const ok = matches(ledger, p, unit)
      if (!ok) unverified.push(raw)
      segments.push({ text: raw, verified: ok })
    }
    last = start + raw.length
  }
  if (last < text.length) segments.push({ text: text.slice(last) })
  return { segments, checked, unverified }
}

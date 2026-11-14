import type { Crop } from './types'

/**
 * Crop knowledge base for the Maneadero valley (coastal Baja California, Mediterranean / semi-arid,
 * winter rains, irrigated from an aquifer affected by seawater intrusion).
 *
 * Sources (shown in the UI):
 *  - FAO-56 (Allen et al. 1998), Tables 11, 12, 22: stage lengths, Kc, rooting depth, depletion fraction p.
 *  - FAO-29 (Ayers & Westcot 1985) Table 4 / Maas & Hoffman (1977): salinity threshold & slope.
 *    Values marked `estimated: true` are not in that table and were set by analogy.
 *  - FAO ECOCROP: optimal temperature ranges (rounded, approximate).
 *  - SARE "Managing Cover Crops Profitably" (3rd ed.): cover-crop biomass and N credits (mid-range values).
 *  - marketIndex is a RELATIVE placeholder (0–10) for gross margin. Replace with local prices
 *    (e.g. SIAP / SADER Baja California) before real use.
 *
 * Planting days-of-year are typical for the Maneadero valley; season A = spring/summer, B = fall/winter.
 */

const FEB1 = 32
const FEB15 = 46
const MAR1 = 60
const MAR10 = 69
const MAR15 = 74
const APR1 = 91
const APR15 = 105
const MAY1 = 121
const MAY15 = 135
const AUG15 = 227
const AUG20 = 232
const SEP15 = 258
const OCT1 = 274
const OCT15 = 288
const OCT25 = 298
const NOV1 = 305
const NOV15 = 319

export const CROPS: Crop[] = [
  // ───────────── Solanaceae ─────────────
  {
    id: 'tomato', name: 'Tomato', nameEs: 'Jitomate', family: 'Solanaceae', kind: 'cash',
    plant: { A: MAR1 }, stages: [30, 40, 40, 25], kc: [0.6, 1.15, 0.8], rootDepthM: 1.0, p: 0.4, maxCover: 0.8,
    tOpt: [20, 27], frostKillC: 0, heatStressC: 35, salinity: { threshold: 2.5, slope: 9.9 },
    nDemandKg: 200, nCreditKg: 0, residueT: 2.5, marketIndex: 9, irrigation: 'full', returnYears: 3,
  },
  {
    id: 'pepper', name: 'Bell / chile pepper', nameEs: 'Chile', family: 'Solanaceae', kind: 'cash',
    plant: { A: MAR10 }, stages: [25, 35, 40, 20], kc: [0.6, 1.05, 0.9], rootDepthM: 0.7, p: 0.3, maxCover: 0.7,
    tOpt: [20, 28], frostKillC: 0, heatStressC: 35, salinity: { threshold: 1.5, slope: 14 },
    nDemandKg: 180, nCreditKg: 0, residueT: 2, marketIndex: 8, irrigation: 'full', returnYears: 3,
  },
  {
    id: 'potato', name: 'Potato', nameEs: 'Papa', family: 'Solanaceae', kind: 'cash',
    plant: { A: FEB1, B: AUG20 }, stages: [25, 30, 30, 20], kc: [0.5, 1.15, 0.75], rootDepthM: 0.5, p: 0.35, maxCover: 0.8,
    tOpt: [15, 20], frostKillC: -1, heatStressC: 30, salinity: { threshold: 1.7, slope: 12 },
    nDemandKg: 200, nCreditKg: 0, residueT: 1.5, marketIndex: 5, irrigation: 'full', returnYears: 3,
  },
  // ───────────── Cucurbitaceae ─────────────
  {
    id: 'cucumber', name: 'Cucumber', nameEs: 'Pepino', family: 'Cucurbitaceae', kind: 'cash',
    plant: { A: MAR15, B: AUG15 }, stages: [20, 30, 40, 15], kc: [0.6, 1.0, 0.75], rootDepthM: 0.9, p: 0.5, maxCover: 0.7,
    tOpt: [20, 30], frostKillC: 0, heatStressC: 35, salinity: { threshold: 2.5, slope: 13 },
    nDemandKg: 120, nCreditKg: 0, residueT: 1.5, marketIndex: 7, irrigation: 'full', returnYears: 2,
  },
  {
    id: 'squash', name: 'Zucchini / squash', nameEs: 'Calabacita', family: 'Cucurbitaceae', kind: 'cash',
    plant: { A: MAR15, B: AUG20 }, stages: [25, 35, 25, 15], kc: [0.5, 0.95, 0.75], rootDepthM: 0.8, p: 0.5, maxCover: 0.75,
    tOpt: [18, 28], frostKillC: 0, heatStressC: 35, salinity: { threshold: 4.7, slope: 9.4 },
    nDemandKg: 100, nCreditKg: 0, residueT: 1.5, marketIndex: 6, irrigation: 'full', returnYears: 2,
  },
  // ───────────── Poaceae (grains / forage) ─────────────
  {
    id: 'sweetcorn', name: 'Sweet corn', nameEs: 'Elote', family: 'Poaceae', kind: 'cash',
    plant: { A: MAR15 }, stages: [20, 25, 25, 20], kc: [0.3, 1.15, 1.05], rootDepthM: 1.0, p: 0.5, maxCover: 0.85,
    tOpt: [18, 33], frostKillC: 0, heatStressC: 38, salinity: { threshold: 1.7, slope: 12 },
    nDemandKg: 160, nCreditKg: 0, residueT: 5, marketIndex: 5, irrigation: 'full', returnYears: 1,
  },
  {
    id: 'sorghum', name: 'Grain sorghum', nameEs: 'Sorgo', family: 'Poaceae', kind: 'cash',
    plant: { A: APR15 }, stages: [20, 35, 40, 30], kc: [0.3, 1.0, 0.55], rootDepthM: 1.4, p: 0.55, maxCover: 0.85,
    tOpt: [27, 35], frostKillC: 0, heatStressC: 40, salinity: { threshold: 6.8, slope: 16 },
    nDemandKg: 120, nCreditKg: 0, residueT: 5, marketIndex: 2, irrigation: 'full', returnYears: 1,
  },
  {
    id: 'barley', name: 'Barley (grain)', nameEs: 'Cebada', family: 'Poaceae', kind: 'cash',
    plant: { B: NOV15 }, stages: [15, 25, 50, 30], kc: [0.3, 1.15, 0.25], rootDepthM: 1.2, p: 0.55, maxCover: 0.9,
    tOpt: [15, 20], frostKillC: -8, heatStressC: 32, salinity: { threshold: 8.0, slope: 5.0 },
    nDemandKg: 80, nCreditKg: 0, residueT: 3, marketIndex: 2, irrigation: 'full', returnYears: 1,
  },
  {
    id: 'wheat', name: 'Wheat', nameEs: 'Trigo', family: 'Poaceae', kind: 'cash',
    plant: { B: NOV15 }, stages: [20, 25, 60, 30], kc: [0.4, 1.15, 0.25], rootDepthM: 1.4, p: 0.55, maxCover: 0.9,
    tOpt: [15, 23], frostKillC: -8, heatStressC: 32, salinity: { threshold: 6.0, slope: 7.1 },
    nDemandKg: 120, nCreditKg: 0, residueT: 3.5, marketIndex: 2, irrigation: 'full', returnYears: 1,
  },
  {
    id: 'oathay', name: 'Oat hay', nameEs: 'Avena forrajera', family: 'Poaceae', kind: 'forage',
    plant: { B: NOV1 }, stages: [15, 30, 45, 20], kc: [0.3, 1.1, 0.9], rootDepthM: 1.0, p: 0.55, maxCover: 0.9,
    tOpt: [15, 25], frostKillC: -6, heatStressC: 32, salinity: { threshold: 4.0, slope: 8, estimated: true },
    nDemandKg: 70, nCreditKg: 0, residueT: 0.8, marketIndex: 2.5, irrigation: 'full', returnYears: 1,
    notes: 'Hay is removed, so little residue returns to the soil.',
  },
  // ───────────── Alliaceae ─────────────
  {
    id: 'greenonion', name: 'Green onion', nameEs: 'Cebollín', family: 'Alliaceae', kind: 'cash',
    plant: { A: FEB1, B: OCT1 }, stages: [25, 30, 10, 5], kc: [0.7, 1.0, 1.0], rootDepthM: 0.4, p: 0.3, maxCover: 0.4,
    tOpt: [13, 24], frostKillC: -3, heatStressC: 35, salinity: { threshold: 1.2, slope: 16 },
    nDemandKg: 100, nCreditKg: 0, residueT: 0.3, marketIndex: 7, irrigation: 'full', returnYears: 3,
  },
  {
    id: 'onion', name: 'Dry onion', nameEs: 'Cebolla', family: 'Alliaceae', kind: 'cash',
    plant: { B: OCT15 }, stages: [15, 25, 70, 40], kc: [0.7, 1.05, 0.75], rootDepthM: 0.4, p: 0.3, maxCover: 0.45,
    tOpt: [13, 24], frostKillC: -3, heatStressC: 35, salinity: { threshold: 1.2, slope: 16 },
    nDemandKg: 150, nCreditKg: 0, residueT: 0.5, marketIndex: 5, irrigation: 'full', returnYears: 3,
  },
  {
    id: 'garlic', name: 'Garlic', nameEs: 'Ajo', family: 'Alliaceae', kind: 'cash',
    plant: { B: OCT15 }, stages: [30, 50, 80, 40], kc: [0.7, 1.0, 0.7], rootDepthM: 0.4, p: 0.3, maxCover: 0.4,
    tOpt: [12, 24], frostKillC: -8, heatStressC: 32, salinity: { threshold: 1.2, slope: 16, estimated: true },
    nDemandKg: 150, nCreditKg: 0, residueT: 0.5, marketIndex: 6, irrigation: 'full', returnYears: 3,
  },
  // ───────────── Apiaceae ─────────────
  {
    id: 'cilantro', name: 'Cilantro', nameEs: 'Cilantro', family: 'Apiaceae', kind: 'cash',
    plant: { A: FEB15, B: OCT1 }, stages: [20, 20, 15, 5], kc: [0.7, 1.0, 0.95], rootDepthM: 0.4, p: 0.3, maxCover: 0.6,
    tOpt: [17, 27], frostKillC: -3, heatStressC: 30, salinity: { threshold: 1.5, slope: 12, estimated: true },
    nDemandKg: 80, nCreditKg: 0, residueT: 0.3, marketIndex: 6, irrigation: 'full', returnYears: 2,
    notes: 'Not in FAO-56; parameters taken from spinach/carrot analogues.',
  },
  {
    id: 'carrot', name: 'Carrot', nameEs: 'Zanahoria', family: 'Apiaceae', kind: 'cash',
    plant: { B: SEP15 }, stages: [30, 40, 35, 15], kc: [0.7, 1.05, 0.95], rootDepthM: 0.7, p: 0.35, maxCover: 0.7,
    tOpt: [16, 24], frostKillC: -3, heatStressC: 32, salinity: { threshold: 1.0, slope: 14 },
    nDemandKg: 100, nCreditKg: 0, residueT: 1, marketIndex: 4, irrigation: 'full', returnYears: 2,
  },
  // ───────────── Brassicaceae ─────────────
  {
    id: 'broccoli', name: 'Broccoli', nameEs: 'Brócoli', family: 'Brassicaceae', kind: 'cash',
    plant: { A: FEB1, B: SEP15 }, stages: [35, 45, 40, 15], kc: [0.7, 1.05, 0.95], rootDepthM: 0.5, p: 0.45, maxCover: 0.8,
    tOpt: [15, 20], frostKillC: -3, heatStressC: 30, salinity: { threshold: 2.8, slope: 9.2 },
    nDemandKg: 180, nCreditKg: 0, residueT: 3.5, marketIndex: 6, irrigation: 'full', returnYears: 3,
  },
  {
    id: 'cabbage', name: 'Cabbage', nameEs: 'Repollo', family: 'Brassicaceae', kind: 'cash',
    plant: { B: SEP15 }, stages: [40, 60, 50, 15], kc: [0.7, 1.05, 0.95], rootDepthM: 0.6, p: 0.45, maxCover: 0.85,
    tOpt: [15, 20], frostKillC: -6, heatStressC: 30, salinity: { threshold: 1.8, slope: 9.7 },
    nDemandKg: 200, nCreditKg: 0, residueT: 2, marketIndex: 4, irrigation: 'full', returnYears: 3,
  },
  {
    id: 'radish', name: 'Radish', nameEs: 'Rábano', family: 'Brassicaceae', kind: 'cash',
    plant: { A: FEB15, B: OCT15 }, stages: [5, 10, 15, 5], kc: [0.7, 0.9, 0.85], rootDepthM: 0.4, p: 0.3, maxCover: 0.5,
    tOpt: [13, 22], frostKillC: -3, heatStressC: 30, salinity: { threshold: 1.2, slope: 13 },
    nDemandKg: 50, nCreditKg: 0, residueT: 0.3, marketIndex: 4, irrigation: 'full', returnYears: 3,
  },
  // ───────────── Asteraceae / Amaranthaceae ─────────────
  {
    id: 'lettuce', name: 'Lettuce', nameEs: 'Lechuga', family: 'Asteraceae', kind: 'cash',
    plant: { A: FEB1, B: OCT1 }, stages: [20, 30, 15, 10], kc: [0.7, 1.0, 0.95], rootDepthM: 0.4, p: 0.3, maxCover: 0.7,
    tOpt: [15, 22], frostKillC: -2, heatStressC: 28, salinity: { threshold: 1.3, slope: 13 },
    nDemandKg: 120, nCreditKg: 0, residueT: 0.8, marketIndex: 6, irrigation: 'full', returnYears: 2,
  },
  {
    id: 'sunflower', name: 'Sunflower', nameEs: 'Girasol', family: 'Asteraceae', kind: 'cash',
    plant: { A: APR1 }, stages: [25, 35, 45, 25], kc: [0.35, 1.0, 0.35], rootDepthM: 1.2, p: 0.45, maxCover: 0.8,
    tOpt: [18, 28], frostKillC: -2, heatStressC: 36, salinity: { threshold: 4.8, slope: 5.0, estimated: true },
    nDemandKg: 80, nCreditKg: 0, residueT: 4, marketIndex: 2.5, irrigation: 'full', returnYears: 2,
  },
  {
    id: 'spinach', name: 'Spinach', nameEs: 'Espinaca', family: 'Amaranthaceae', kind: 'cash',
    plant: { A: FEB1, B: OCT15 }, stages: [20, 20, 15, 5], kc: [0.7, 1.0, 0.95], rootDepthM: 0.4, p: 0.2, maxCover: 0.7,
    tOpt: [15, 20], frostKillC: -6, heatStressC: 28, salinity: { threshold: 2.0, slope: 7.6 },
    nDemandKg: 120, nCreditKg: 0, residueT: 0.5, marketIndex: 5, irrigation: 'full', returnYears: 2,
  },
  // ───────────── Rosaceae ─────────────
  {
    id: 'strawberry', name: 'Strawberry (annual)', nameEs: 'Fresa', family: 'Rosaceae', kind: 'cash',
    plant: { B: OCT15 }, stages: [40, 60, 100, 30], kc: [0.4, 0.85, 0.75], rootDepthM: 0.3, p: 0.2, maxCover: 0.7,
    tOpt: [15, 26], frostKillC: -3, heatStressC: 32, salinity: { threshold: 1.0, slope: 33 },
    nDemandKg: 150, nCreditKg: 0, residueT: 1, marketIndex: 12, irrigation: 'full', returnYears: 3,
    notes: 'Occupies the field Oct → Jun, so the next spring slot stays empty.',
  },
  // ───────────── Fabaceae (cash / forage) ─────────────
  {
    id: 'greenbean', name: 'Green bean', nameEs: 'Ejote', family: 'Fabaceae', kind: 'cash',
    plant: { A: APR1, B: AUG15 }, stages: [20, 30, 30, 10], kc: [0.5, 1.05, 0.9], rootDepthM: 0.7, p: 0.45, maxCover: 0.7,
    tOpt: [16, 25], frostKillC: 0, heatStressC: 32, salinity: { threshold: 1.0, slope: 19 },
    nDemandKg: 60, nCreditKg: 20, residueT: 1.5, marketIndex: 5, irrigation: 'full', returnYears: 2,
  },
  {
    id: 'drybean', name: 'Dry bean', nameEs: 'Frijol', family: 'Fabaceae', kind: 'cash',
    plant: { A: APR1 }, stages: [20, 30, 40, 20], kc: [0.4, 1.15, 0.35], rootDepthM: 0.7, p: 0.45, maxCover: 0.7,
    tOpt: [16, 25], frostKillC: 0, heatStressC: 32, salinity: { threshold: 1.0, slope: 19 },
    nDemandKg: 40, nCreditKg: 20, residueT: 1.5, marketIndex: 3, irrigation: 'full', returnYears: 2,
  },
  {
    id: 'chickpea', name: 'Chickpea', nameEs: 'Garbanzo', family: 'Fabaceae', kind: 'cash',
    plant: { B: NOV15 }, stages: [25, 35, 40, 20], kc: [0.4, 1.0, 0.35], rootDepthM: 0.8, p: 0.5, maxCover: 0.7,
    tOpt: [15, 29], frostKillC: -3, heatStressC: 33, salinity: { threshold: 1.0, slope: 15, estimated: true },
    nDemandKg: 20, nCreditKg: 20, residueT: 1.5, marketIndex: 3, irrigation: 'full', returnYears: 2,
  },
  {
    id: 'fava', name: 'Fava bean', nameEs: 'Haba', family: 'Fabaceae', kind: 'cash',
    plant: { B: OCT15 }, stages: [25, 35, 45, 25], kc: [0.5, 1.15, 1.1], rootDepthM: 0.7, p: 0.45, maxCover: 0.75,
    tOpt: [15, 20], frostKillC: -5, heatStressC: 28, salinity: { threshold: 1.6, slope: 9.6 },
    nDemandKg: 20, nCreditKg: 50, residueT: 2.5, marketIndex: 3, irrigation: 'full', returnYears: 2,
  },
  {
    id: 'alfalfa', name: 'Alfalfa (2-yr stand)', nameEs: 'Alfalfa', family: 'Fabaceae', kind: 'forage',
    plant: { B: OCT1 }, stages: [30, 30, 610, 30], kc: [0.4, 0.95, 0.9], rootDepthM: 1.5, p: 0.55, maxCover: 0.9,
    tOpt: [15, 30], frostKillC: -10, heatStressC: 38, salinity: { threshold: 2.0, slope: 7.3 },
    nDemandKg: 20, nCreditKg: 120, residueT: 3, marketIndex: 8, irrigation: 'full', returnYears: 3,
    notes: 'Kc is a season average over cutting cycles. Stand occupies ~2 years.',
  },
  // ───────────── Cover crops (fall/winter, mostly rain-fed) ─────────────
  {
    id: 'vetch', name: 'Common vetch (cover)', nameEs: 'Veza (cobertura)', family: 'Fabaceae', kind: 'cover',
    plant: { B: OCT25 }, stages: [20, 40, 40, 10], kc: [0.4, 1.0, 0.9], rootDepthM: 0.8, p: 0.5, maxCover: 0.85,
    tOpt: [12, 25], frostKillC: -10, heatStressC: 30, salinity: { threshold: 3.0, slope: 11 },
    nDemandKg: 0, nCreditKg: 90, residueT: 4, marketIndex: 0, irrigation: 'establish', returnYears: 1,
  },
  {
    id: 'berseem', name: 'Berseem clover (cover)', nameEs: 'Trébol bersim', family: 'Fabaceae', kind: 'cover',
    plant: { B: OCT25 }, stages: [20, 40, 40, 10], kc: [0.4, 0.9, 0.85], rootDepthM: 0.7, p: 0.5, maxCover: 0.85,
    tOpt: [12, 25], frostKillC: -4, heatStressC: 32, salinity: { threshold: 1.5, slope: 5.7 },
    nDemandKg: 0, nCreditKg: 70, residueT: 3.5, marketIndex: 0, irrigation: 'establish', returnYears: 1,
  },
  {
    id: 'barleyvetch', name: 'Barley–vetch mix (cover)', nameEs: 'Cebada–veza', family: 'Poaceae', kind: 'cover',
    plant: { B: OCT25 }, stages: [20, 35, 45, 10], kc: [0.35, 1.05, 0.6], rootDepthM: 1.0, p: 0.55, maxCover: 0.9,
    tOpt: [12, 22], frostKillC: -8, heatStressC: 32, salinity: { threshold: 5.0, slope: 7, estimated: true },
    nDemandKg: 0, nCreditKg: 50, residueT: 5, marketIndex: 0, irrigation: 'establish', returnYears: 1,
    notes: 'Mix: barley gives fast cover and residue, vetch fixes N.',
  },
  {
    id: 'barleycover', name: 'Barley (cover)', nameEs: 'Cebada (cobertura)', family: 'Poaceae', kind: 'cover',
    plant: { B: OCT25 }, stages: [15, 30, 40, 10], kc: [0.3, 1.1, 0.5], rootDepthM: 1.0, p: 0.55, maxCover: 0.9,
    tOpt: [12, 20], frostKillC: -8, heatStressC: 32, salinity: { threshold: 8.0, slope: 5.0 },
    nDemandKg: 0, nCreditKg: 0, residueT: 5, marketIndex: 0, irrigation: 'establish', returnYears: 1,
  },
  {
    id: 'mustard', name: 'Mustard (biofumigant cover)', nameEs: 'Mostaza', family: 'Brassicaceae', kind: 'cover',
    plant: { B: OCT25 }, stages: [15, 30, 35, 10], kc: [0.35, 1.0, 0.6], rootDepthM: 1.0, p: 0.5, maxCover: 0.85,
    tOpt: [10, 25], frostKillC: -5, heatStressC: 30, salinity: { threshold: 3.0, slope: 8, estimated: true },
    nDemandKg: 0, nCreditKg: 0, residueT: 4, marketIndex: 0, irrigation: 'establish', returnYears: 1, biofumigant: true,
    notes: 'Incorporated mustard can suppress some soil-borne pathogens and nematodes (evidence is mixed).',
  },
  {
    id: 'phacelia', name: 'Phacelia (cover)', nameEs: 'Facelia', family: 'Boraginaceae', kind: 'cover',
    plant: { B: OCT25 }, stages: [15, 30, 35, 10], kc: [0.35, 1.0, 0.6], rootDepthM: 0.8, p: 0.5, maxCover: 0.8,
    tOpt: [10, 25], frostKillC: -6, heatStressC: 30, salinity: { threshold: 2.0, slope: 10, estimated: true },
    nDemandKg: 0, nCreditKg: 0, residueT: 3.5, marketIndex: 0, irrigation: 'establish', returnYears: 1,
    notes: 'Unrelated to any cash crop family, so it breaks pest cycles; attracts pollinators.',
  },
  // ───────────── Cover crops (summer, irrigated) ─────────────
  {
    id: 'cowpeacover', name: 'Cowpea (summer cover)', nameEs: 'Caupí', family: 'Fabaceae', kind: 'cover',
    plant: { A: MAY1 }, stages: [15, 25, 30, 10], kc: [0.4, 1.05, 0.6], rootDepthM: 0.8, p: 0.5, maxCover: 0.85,
    tOpt: [22, 35], frostKillC: 0, heatStressC: 40, salinity: { threshold: 4.9, slope: 12 },
    nDemandKg: 0, nCreditKg: 60, residueT: 4, marketIndex: 0, irrigation: 'full', returnYears: 1,
  },
  {
    id: 'sudangrass', name: 'Sorghum-sudangrass (summer cover)', nameEs: 'Sudán', family: 'Poaceae', kind: 'cover',
    plant: { A: MAY1 }, stages: [15, 30, 40, 15], kc: [0.4, 1.0, 0.85], rootDepthM: 1.2, p: 0.55, maxCover: 0.9,
    tOpt: [25, 35], frostKillC: 0, heatStressC: 40, salinity: { threshold: 2.8, slope: 4.3 },
    nDemandKg: 0, nCreditKg: 0, residueT: 8, marketIndex: 0, irrigation: 'full', returnYears: 1,
  },
  {
    id: 'buckwheat', name: 'Buckwheat (summer cover)', nameEs: 'Trigo sarraceno', family: 'Polygonaceae', kind: 'cover',
    plant: { A: MAY15 }, stages: [10, 20, 20, 10], kc: [0.4, 1.0, 0.7], rootDepthM: 0.6, p: 0.5, maxCover: 0.8,
    tOpt: [18, 25], frostKillC: 0, heatStressC: 32, salinity: { threshold: 1.5, slope: 12, estimated: true },
    nDemandKg: 0, nCreditKg: 0, residueT: 2.5, marketIndex: 0, irrigation: 'full', returnYears: 1,
  },
]

export const CROP_BY_ID: Record<string, Crop> = Object.fromEntries(CROPS.map((c) => [c.id, c]))

export function cropDuration(c: Crop): number {
  return c.stages[0] + c.stages[1] + c.stages[2] + c.stages[3]
}

export const SOURCES = {
  fao56: 'FAO-56, Allen et al. 1998 (crop coefficients, stage lengths, rooting depth)',
  fao29: 'FAO-29, Ayers & Westcot 1985 / Maas & Hoffman 1977 (salinity tolerance)',
  ecocrop: 'FAO ECOCROP (temperature ranges, approximate)',
  sare: 'SARE, Managing Cover Crops Profitably, 3rd ed. (cover-crop biomass and N credits)',
  power: 'NASA POWER daily (MERRA-2 / CERES), 1995–2024',
  soilgrids: 'ISRIC SoilGrids 250 m v2.0',
  rusle: 'RUSLE (Renard et al. 1997), EPIC K-factor (Williams 1995)',
  market: 'Relative market index: placeholder, replace with local prices',
}

/** Typical current rotation for an irrigated Maneadero vegetable field. */
export const DEFAULT_CURRENT: (string | null)[] = ['tomato', 'greenonion', 'pepper', 'cilantro', 'tomato', null]

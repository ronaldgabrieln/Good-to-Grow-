// Tool definitions for the planning agent. Pure data (no DOM), shared by the local server (which
// sends them to the API) and the browser (which runs them against the engine).
// Schemas are strict: every property required, no extra properties, crops limited to known ids.

import type Anthropic from '@anthropic-ai/sdk'
import { CROPS } from '../engine/crops'

export const CROP_IDS = CROPS.map((c) => c.id)
export const SLOT_VALUES = [...CROP_IDS, 'none']
export const OPTION_KEYS = ['current', 'small-change', 'best', 'different'] as const
export const LAYERS = ['erosion', 'water', 'satellite'] as const
export type OptionKey = (typeof OPTION_KEYS)[number]
/** Plans the farmer can look at: the engine's options plus "yours", the plan edited with the helper. */
export const PLAN_KEYS = [...OPTION_KEYS, 'yours'] as const
export type PlanKey = (typeof PLAN_KEYS)[number]

const SLOTS_SCHEMA = {
  type: 'array',
  description:
    'Exactly 6 entries, in order: Year 1 spring, Year 1 fall, Year 2 spring, Year 2 fall, Year 3 spring, Year 3 fall. ' +
    'Use a crop id, or "none" when nothing new is planted that season.',
  items: { type: 'string', enum: SLOT_VALUES },
}

/** A rotation to look at: one of the options on screen, or a custom 6-slot rotation. */
const TARGET_SCHEMA = {
  type: 'object',
  properties: {
    option: {
      type: 'string',
      enum: [...PLAN_KEYS, 'custom'],
      description:
        'One of the plans shown to the farmer ("yours" is the plan the farmer edited with you, if they have one), or "custom" to use the slots field.',
    },
    slots: { ...SLOTS_SCHEMA, description: 'Only read when option is "custom"; send an empty array otherwise. ' + SLOTS_SCHEMA.description },
  },
  required: ['option', 'slots'],
  additionalProperties: false,
}

const noInput = { type: 'object' as const, properties: {}, required: [], additionalProperties: false }

export const AGENT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'get_field_overview',
    description:
      "The farmer's field: location, soil, 30 years of climate (rain, crop water demand, dry years, frost, heat), how the data was handled, known information gaps, the agronomic rules the engine applies, and the data sources. Call this before talking about the field, climate or data quality.",
    input_schema: noInput,
    strict: true,
  },
  {
    name: 'get_ground_readings',
    description:
      "Soil moisture measured on the farmer's own field by the GoodToGrow sensor node (a soil probe on an Arduino), as opposed to the satellite and model data: when it was recorded, how wet the soil was at the start and end, how fast it is drying, the field-capacity reading estimated from how the soil drained, the NASA POWER water demand for that month, what the readings mean, and what the sensor did not measure. Call this when the farmer asks how wet their soil is, about their sensor, or about measured (not modeled) data.",
    input_schema: noInput,
    strict: true,
  },
  {
    name: 'get_options',
    description:
      'The plans on screen: the farmer\'s current rotation, the suggested ones (small change, best, different) and the farmer\'s edited plan ("yours") if there is one, plus which plan the farmer is looking at. For each: crops by season, modeled water, income index, soil, nitrogen, erosion, pest-break and failure-risk figures, the precomputed % change versus the current rotation, why it was suggested, risks, evidence and the extension-agent advice.',
    input_schema: noInput,
    strict: true,
  },
  {
    name: 'evaluate_rotation',
    description:
      "Replay any 6-season rotation (for example the farmer's own idea) through 30 years of their field's weather. Returns rule problems, modeled figures, % change versus the current rotation, frost/heat/salinity events per crop and evidence. Use it to test 'what if' ideas instead of guessing.",
    input_schema: {
      type: 'object',
      properties: { slots: SLOTS_SCHEMA },
      required: ['slots'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'compare_rotations',
    description: 'Compare two rotations side by side (options or custom). Returns both sets of figures and the precomputed differences of b versus a.',
    input_schema: {
      type: 'object',
      properties: { a: TARGET_SCHEMA, b: TARGET_SCHEMA },
      required: ['a', 'b'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'test_climate',
    description:
      'Replay a rotation under a changed climate: every one of the 30 years made warmer and/or wetter/drier. warmer_c from 0 to 3; rain_change_pct from -30 to 10. Returns figures under the scenario next to the observed-climate figures.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET_SCHEMA,
        warmer_c: { type: 'number', description: 'Degrees Celsius added to every day, 0 to 3.' },
        rain_change_pct: { type: 'number', description: 'Percent change in rainfall, -30 to 10.' },
      },
      required: ['target', 'warmer_c', 'rain_change_pct'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'crop_info',
    description:
      "One crop from the engine's knowledge base: local planting dates, season length, water use, rooting depth, salt tolerance, frost/heat limits, nitrogen need or credit, residue, plant family and break interval, with sources and whether values are estimated.",
    input_schema: {
      type: 'object',
      properties: { crop: { type: 'string', enum: CROP_IDS } },
      required: ['crop'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'season_plan',
    description:
      'A dated task list for a rotation over its 3 years: when to sow and harvest each crop, cover-crop establishment irrigation and termination, and the periods the field is bare in the rainy season. Dates are computed from the engine\'s planting windows.',
    input_schema: {
      type: 'object',
      properties: { target: TARGET_SCHEMA },
      required: ['target'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'show_on_land',
    description:
      "Show an option on the farmer's 3D view of their land, with a layer: erosion (soil washing away), water (where rain water runs) or satellite (just the photo). Use it when seeing the land would help the farmer understand.",
    input_schema: {
      type: 'object',
      properties: {
        option: { type: 'string', enum: [...PLAN_KEYS] },
        layer: { type: 'string', enum: [...LAYERS] },
      },
      required: ['option', 'layer'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'propose_change',
    description:
      "Propose a change to one of the farmer's plans. The app replays the changed rotation, shows the farmer what changes (seasons, water, income, soil) and asks them to Allow or Deny; this call returns their decision. If allowed, the changed rotation becomes \"yours\" (Your plan) and is shown on screen. Send the complete 6-season rotation after the change, keeping every season the farmer did not want changed. One proposal at a time; never say a plan was changed unless this returns decision \"allowed\".",
    input_schema: {
      type: 'object',
      properties: {
        base: { type: 'string', enum: [...PLAN_KEYS], description: 'The plan being changed.' },
        slots: { ...SLOTS_SCHEMA, description: 'The whole rotation after the change. ' + SLOTS_SCHEMA.description },
        reason: { type: 'string', description: 'One short plain sentence, in the language the farmer uses, saying what changes and why.' },
      },
      required: ['base', 'slots', 'reason'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'recall_farmer',
    description:
      "Read what is saved about this farmer in their profile: the facts they allowed you to remember and the plans they saved before (with the figures computed when they saved them). Call it once at the start of a conversation when the app note says a farmer is signed in, and whenever the farmer refers to earlier conversations or saved plans ('last time', 'the plan I saved', 'my well'). Returns signed_in false when nobody is signed in.",
    input_schema: noInput,
    strict: true,
  },
  {
    name: 'propose_memory',
    description:
      "Ask to remember one lasting fact about the farmer or their farm for future conversations, for example a measured well salinity, crops they will not grow, their irrigation equipment or where they sell. The app shows the fact and the farmer taps Allow or Deny; this call returns their decision. Only facts the farmer stated themselves in this conversation; never names, contact details, health, debts or anything they did not say. One fact per call; never say something was remembered unless this returns decision \"allowed\".",
    input_schema: {
      type: 'object',
      properties: {
        fact: {
          type: 'string',
          description: 'The fact as one short sentence in the language the farmer uses, written about the farm, e.g. "Well water tested 2.1 dS/m (farmer, 2026)." or "Will not grow strawberries: no labour for picking."',
        },
      },
      required: ['fact'],
      additionalProperties: false,
    },
    strict: true,
  },
]

export const TOOL_NAMES = AGENT_TOOLS.map((t) => t.name)

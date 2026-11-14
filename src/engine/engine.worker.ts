// Runs the rotation engine off the main thread so sliders stay responsive.
//   { id, input }                         → full run (candidate search + shortlist)
//   { id, kind: 'evaluate', input, items } → replay specific rotations (used by the planning agent)
import { evaluateSlots, runEngine, type EngineInput } from './index'
import type { Scenario, Slots } from './types'

type Request =
  | { id: number; kind?: 'run'; input: EngineInput }
  | { id: number; kind: 'evaluate'; input: EngineInput; items: { slots: Slots; scenario?: Scenario }[] }

self.onmessage = (e: MessageEvent<Request>) => {
  const req = e.data
  try {
    if (req.kind === 'evaluate') self.postMessage({ id: req.id, evaluations: evaluateSlots(req.input, req.items) })
    else self.postMessage({ id: req.id, result: runEngine(req.input) })
  } catch (err) {
    self.postMessage({ id: req.id, error: (err as Error).message ?? String(err) })
  }
}

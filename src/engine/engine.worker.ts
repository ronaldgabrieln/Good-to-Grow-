// Runs the rotation engine off the main thread so sliders stay responsive.
import { runEngine, type EngineInput } from './index'

self.onmessage = (e: MessageEvent<{ id: number; input: EngineInput }>) => {
  const { id, input } = e.data
  try {
    const result = runEngine(input)
    self.postMessage({ id, result })
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message ?? String(err) })
  }
}

import { useCallback, useEffect, useRef } from 'react'
import type { EngineInput, Scenario, SlotEvaluation, Slots } from '../engine'

type Pending = { resolve: (v: SlotEvaluation[]) => void; reject: (e: Error) => void }

/**
 * A dedicated engine worker for on-demand "what if" replays (the planning agent's tools), so they
 * never cancel or delay the main results run.
 */
export function useEvaluator() {
  const worker = useRef<Worker | null>(null)
  const pending = useRef(new Map<number, Pending>())
  const nextId = useRef(0)

  useEffect(() => {
    const w = new Worker(new URL('../engine/engine.worker.ts', import.meta.url), { type: 'module' })
    const waiting = pending.current
    w.onmessage = (e: MessageEvent<{ id: number; evaluations?: SlotEvaluation[]; error?: string }>) => {
      const p = waiting.get(e.data.id)
      if (!p) return
      waiting.delete(e.data.id)
      if (e.data.error) p.reject(new Error(e.data.error))
      else p.resolve(e.data.evaluations ?? [])
    }
    worker.current = w
    return () => {
      w.terminate()
      for (const p of waiting.values()) p.reject(new Error('Evaluator stopped'))
      waiting.clear()
    }
  }, [])

  return useCallback((input: EngineInput, items: { slots: Slots; scenario?: Scenario }[]) => {
    const w = worker.current
    if (!w) return Promise.reject(new Error('Evaluator not ready'))
    const id = ++nextId.current
    return new Promise<SlotEvaluation[]>((resolve, reject) => {
      pending.current.set(id, { resolve, reject })
      w.postMessage({ id, kind: 'evaluate', input, items })
    })
  }, [])
}

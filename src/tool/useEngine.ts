import { useEffect, useRef, useState } from 'react'
import type { EngineInput, EngineResult } from '../engine'

/** Runs the engine in a Web Worker; only the latest request's result is kept. Debounced. */
export function useEngine(input: EngineInput | null, debounceMs = 150) {
  const workerRef = useRef<Worker | null>(null)
  const reqId = useRef(0)
  const [result, setResult] = useState<EngineResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const w = new Worker(new URL('../engine/engine.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ id: number; result?: EngineResult; error?: string }>) => {
      if (e.data.id !== reqId.current) return
      setRunning(false)
      if (e.data.error) setError(e.data.error)
      else if (e.data.result) {
        setError(null)
        setResult(e.data.result)
      }
    }
    w.onerror = (e) => {
      setRunning(false)
      setError(e.message || 'The engine worker failed to start.')
    }
    workerRef.current = w
    return () => w.terminate()
  }, [])

  useEffect(() => {
    if (!input) return
    const t = setTimeout(() => {
      const id = ++reqId.current
      setRunning(true)
      workerRef.current?.postMessage({ id, input })
    }, debounceMs)
    return () => clearTimeout(t)
  }, [input, debounceMs])

  return { result, running, error }
}

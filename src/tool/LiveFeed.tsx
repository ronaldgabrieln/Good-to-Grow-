import { useEffect, useRef, useState } from 'react'
import { pctOfCapacity, type SoilCapacity } from '../engine/ground'
import { fmt } from './format'

// Minimal Web Serial types (Chrome / Edge). Not in TypeScript's DOM library yet.
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  readable: ReadableStream<Uint8Array> | null
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>
}
const serial = typeof navigator !== 'undefined' ? (navigator as Navigator & { serial?: SerialLike }).serial : undefined

interface Point {
  t: number
  raw: number
  tempC: number | null
  rh: number | null
}

const WINDOW_MS = 10 * 60 * 1000 // chart shows the last 10 minutes
const LIVE_LINE = /^T:(\S+) RH:(\S+) Soil:(\S+)(?: Raw:(\S+))?/
const num = (s: string | undefined) => (s === undefined || s === 'nan' ? null : Number.isFinite(Number(s)) ? Number(s) : null)

/** Live readings from the field node over USB (firmware/GoodToGrowNano prints one line every 5 s at 9600 baud). */
export function LiveFeed({ capacity }: { capacity: SoilCapacity | null }) {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [points, setPoints] = useState<Point[]>([])
  const [now, setNow] = useState(() => Date.now())
  const portRef = useRef<SerialPortLike | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)

  const disconnect = async () => {
    try {
      await readerRef.current?.cancel()
    } catch {
      /* already closed */
    }
    readerRef.current = null
    try {
      await portRef.current?.close()
    } catch {
      /* already closed */
    }
    portRef.current = null
    setStatus('idle')
  }

  const connect = async () => {
    if (!serial) return
    setStatus('connecting')
    setMessage(null)
    try {
      const port = await serial.requestPort()
      await port.open({ baudRate: 9600 }) // opening the port restarts the Nano; the first line arrives after ~3 s
      portRef.current = port
      setPoints([])
      setStatus('live')
      setMessage('Connected. The Arduino restarts when connected; the first reading arrives in a few seconds.')
      const reader = port.readable!.getReader()
      readerRef.current = reader
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          const m = LIVE_LINE.exec(line)
          if (m && m[4] !== undefined) {
            const p: Point = { t: Date.now(), raw: Number(m[4]), tempC: num(m[1]), rh: num(m[2]) }
            setPoints((prev) => [...prev.filter((q) => q.t > p.t - WINDOW_MS), p])
            setMessage(null)
          } else if (line.startsWith('#') && /DS3231|clock|booting|log/.test(line) === false) {
            setMessage(line.replace(/^#\s*/, ''))
          }
        }
      }
      reader.releaseLock()
    } catch (e) {
      const err = e as Error
      if (err.name === 'NotFoundError') {
        setStatus('idle') // the user closed the port picker
        return
      }
      setStatus('error')
      setMessage(
        /access|busy|open/i.test(err.message)
          ? 'The port is busy: close the Arduino IDE Serial Monitor (or any other program using it) and try again.'
          : `Connection lost: ${err.message}`,
      )
    } finally {
      try {
        await portRef.current?.close()
      } catch {
        /* already closed */
      }
      portRef.current = null
      readerRef.current = null
      setStatus((s) => (s === 'error' ? s : 'idle'))
    }
  }

  // Close the port when leaving the page, and tick the "seconds ago" label.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(id)
      readerRef.current?.cancel().catch(() => {})
    }
  }, [])

  const last = points[points.length - 1]
  const capRaw = capacity?.raw ?? null
  const pct = (raw: number) => (capRaw ? pctOfCapacity(raw, capRaw) : NaN)

  // Sparkline of the last 10 minutes, in % of the highest peak when known, else raw.
  const W = 320
  const H = 70
  const vals = points.map((p) => (capRaw ? pct(p.raw) : p.raw))
  const lo = vals.length ? Math.min(...vals) : 0
  const hi = vals.length ? Math.max(...vals) : 1
  const pad = Math.max(1, (hi - lo) * 0.15)
  const x = (t: number) => ((t - (now - WINDOW_MS)) / WINDOW_MS) * W
  const y = (v: number) => H - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * H
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(vals[i]).toFixed(1)}`).join(' ')

  return (
    <section className="live-feed" aria-label="Live data from the Arduino">
      <div className="live-head">
        <span className="live-title">
          <i className={`live-dot ${status === 'live' ? 'is-on' : ''}`} aria-hidden /> Live from the Arduino
        </span>
        {!serial ? (
          <span className="small muted">Open this page in Chrome or Edge to connect the Arduino over USB.</span>
        ) : status === 'live' ? (
          <button type="button" className="btn btn-quiet btn-inline" onClick={disconnect}>
            Disconnect
          </button>
        ) : (
          <button type="button" className="btn btn-inline" onClick={connect} disabled={status === 'connecting'}>
            {status === 'connecting' ? 'Choose the port…' : 'Connect Arduino'}
          </button>
        )}
      </div>

      {last && (
        <div className="live-body">
          <div className="live-now">
            <strong>{capRaw ? `${fmt(pct(last.raw))}%` : fmt(last.raw)}</strong>
            <span className="small muted">
              {capRaw ? `of the highest peak · reading ${fmt(last.raw)}` : 'probe reading'}
              {last.tempC !== null ? ` · ${fmt(last.tempC, 1)} °C` : ''}
              {last.rh !== null ? ` · ${fmt(last.rh)}% RH` : ''}
              {` · ${Math.max(0, Math.round((now - last.t) / 1000))} s ago`}
            </span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="live-spark" role="img" aria-label="Soil reading over the last 10 minutes">
            <path d={path} className="live-line" />
            {points.length > 0 && <circle cx={x(last.t)} cy={y(vals[vals.length - 1])} r={3.5} className="live-last" />}
          </svg>
          <span className="small muted">
            last 10 min · {points.length} readings, one every 5 s{last.raw === 0 ? ' · reading 0: is the probe in the soil?' : ''}
          </span>
        </div>
      )}
      {message && <p className={`small ${status === 'error' ? 'error-text' : 'muted'} live-msg`}>{message}</p>}
    </section>
  )
}

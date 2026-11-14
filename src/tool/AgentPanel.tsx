import { useEffect, useRef, useState, type ReactNode } from 'react'
import { checkAnswer, type Ledger } from '../agent/grounding'
import type { AgentContext } from '../agent/toolHandlers'
import { useAgent, type ChatTurn } from '../agent/useAgent'

const STARTERS = [
  '¿Por qué esta es la mejor opción para mí?',
  'What if I keep doing what I do now?',
  '¿Qué tengo que hacer este otoño?',
  'What could go wrong with the best option?',
]

/** Inline text: **bold** plus number marks (numbers not found in the analysis are underlined). */
function inline(text: string, ledger: Ledger | null, key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const bold = part.startsWith('**') && part.endsWith('**') && part.length > 4
    const body = bold ? part.slice(2, -2) : part
    const content = ledger
      ? checkAnswer(body, ledger).segments.map((s, j) =>
          s.verified === false ? (
            <mark key={j} className="unverified" title="This number was not found in the analysis. Double-check it.">
              {s.text}
            </mark>
          ) : (
            s.text
          ),
        )
      : body
    return bold ? <strong key={`${key}-${i}`}>{content}</strong> : <span key={`${key}-${i}`}>{content}</span>
  })
}

/** Paragraphs and "- " bullet lists. */
function Formatted({ text, ledger }: { text: string; ledger: Ledger | null }) {
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  const flush = (k: number) => {
    if (bullets.length) blocks.push(<ul key={`ul${k}`}>{bullets.map((b, i) => <li key={i}>{inline(b, ledger, `b${k}-${i}`)}</li>)}</ul>)
    bullets = []
  }
  text.split('\n').forEach((line, k) => {
    const t = line.trim()
    if (/^[-•*] /.test(t)) bullets.push(t.slice(2))
    else {
      flush(k)
      if (t) blocks.push(<p key={`p${k}`}>{inline(t, ledger, `p${k}`)}</p>)
    }
  })
  flush(-1)
  return <>{blocks}</>
}

function AssistantTurn({ turn }: { turn: ChatTurn }) {
  const done = turn.status === 'done'
  const ledger = done ? (turn.ledger ?? null) : null
  return (
    <div className="msg msg-assistant">
      {turn.steps.length > 0 && (
        <details className="msg-steps" open={!done}>
          <summary>
            {done ? `What I checked (${turn.steps.length})` : 'Checking…'}
          </summary>
          <ul>
            {turn.steps.map((s, i) => (
              <li key={i} className={s.isError ? 'step-error' : ''}>
                {s.summary}
              </li>
            ))}
          </ul>
        </details>
      )}
      {turn.text ? (
        <div className="msg-text">
          <Formatted text={turn.text} ledger={ledger} />
        </div>
      ) : (
        turn.status === 'working' && <p className="msg-thinking">Thinking…</p>
      )}
      {turn.error && <p className={`msg-error ${turn.error.kind === 'not_configured' ? 'is-setup' : ''}`}>{turn.error.message}</p>}
      {done && turn.report && turn.report.checked > 0 && (
        <p className={`msg-check ${turn.report.unverified.length ? 'has-unverified' : ''}`}>
          {turn.report.unverified.length === 0
            ? `✓ All ${turn.report.checked} numbers come from your field's analysis`
            : `⚠ ${turn.report.unverified.length} of ${turn.report.checked} numbers not found in the analysis (underlined). Double-check them.`}
        </p>
      )}
      {done && turn.sources.length > 0 && (
        <details className="msg-sources">
          <summary>Sources</summary>
          <ul>
            {turn.sources.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/** "Ask about your plan": a drawer where the farmer discusses the options with a grounded agent. */
export function AgentPanel({ getContext }: { getContext: () => AgentContext | null }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const { turns, busy, ask, stop, reset } = useAgent(getContext)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [turns])
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const send = (q: string) => {
    if (busy || !q.trim()) return
    setDraft('')
    void ask(q)
  }

  return (
    <>
      {!open && (
        <button type="button" className="agent-fab" onClick={() => setOpen(true)}>
          Ask about your plan
          <span>Pregunta sobre tu plan</span>
        </button>
      )}
      {open && (
        <aside className="agent" aria-label="Ask about your plan">
          <header className="agent-head">
            <div>
              <h2>Ask about your plan</h2>
              <p className="small muted">Answers come only from your field's analysis. Pregunta en español o inglés.</p>
            </div>
            {turns.length > 0 && (
              <button type="button" className="agent-link" onClick={reset} disabled={busy}>
                New chat
              </button>
            )}
            <button type="button" className="agent-close" aria-label="Close" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>

          <div className="agent-log" aria-live="polite">
            {turns.length === 0 && (
              <div className="agent-empty">
                <p>Talk through your options before you decide. For example:</p>
                <div className="agent-starters">
                  {STARTERS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t) =>
              t.role === 'user' ? (
                <div key={t.id} className="msg msg-user">
                  {t.text}
                </div>
              ) : (
                <AssistantTurn key={t.id} turn={t} />
              ),
            )}
            <div ref={endRef} />
          </div>

          <form
            className="agent-input"
            onSubmit={(e) => {
              e.preventDefault()
              send(draft)
            }}
          >
            <textarea
              ref={inputRef}
              value={draft}
              rows={2}
              maxLength={1000}
              placeholder="Ask a question… / Escribe tu pregunta…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(draft)
                }
              }}
            />
            {busy ? (
              <button type="button" className="btn btn-quiet agent-send" onClick={stop}>
                Stop
              </button>
            ) : (
              <button type="submit" className="btn agent-send" disabled={!draft.trim()}>
                Ask
              </button>
            )}
          </form>
          <p className="agent-foot small muted">A guide to discuss with your agronomist, not a rule. Pesticides, prices and diagnosis: ask your agronomist.</p>
        </aside>
      )}
    </>
  )
}

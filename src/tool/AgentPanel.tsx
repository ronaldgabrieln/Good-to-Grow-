import { useEffect, useRef, useState, type ReactNode } from 'react'
import { checkAnswer, type Ledger } from '../agent/grounding'
import type { AgentContext } from '../agent/toolHandlers'
import { useAgent, type ChatProposal, type ChatTurn } from '../agent/useAgent'
import { plainStats } from './plans'

const STARTERS = [
  '¿Por qué me recomiendas este plan?',
  'Change one season of this plan to use less water.',
  '¿Qué tengo que hacer este otoño?',
  'What could go wrong with this plan?',
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

/** A change the helper wants to make: what changes, what it does, and Allow / Deny. */
function ProposalCard({ p, onDecide }: { p: ChatProposal; onDecide: (allowed: boolean) => void }) {
  const stats = p.metrics ? plainStats(p.metrics, p.baseMetrics) : []
  return (
    <div className={`proposal is-${p.status}`} role="group" aria-label={`Proposed change to ${p.baseTitle}`}>
      <p className="proposal-kicker">The helper wants to change</p>
      <p className="proposal-title">{p.baseTitle}</p>
      {p.reason && <p className="proposal-reason">{p.reason}</p>}
      <ul className="proposal-changes">
        {p.changes.map((c) => (
          <li key={c.season}>
            <span className="proposal-season">{c.season}</span>
            <s>{c.from}</s> → <strong>{c.to}</strong>
          </li>
        ))}
      </ul>
      {stats.length > 0 && (
        <ul className="proposal-stats" aria-label="Compared with the plan before the change">
          {stats.map((st) => (
            <li key={st.label} className={`tone-${st.tone}`}>
              {st.tone === 'good' ? '▲' : st.tone === 'bad' ? '▼' : '•'} {st.text}
            </li>
          ))}
        </ul>
      )}
      {p.problems.length > 0 && (
        <ul className="proposal-problems">
          {p.problems.map((x) => (
            <li key={x}>⚠ {x}</li>
          ))}
        </ul>
      )}
      {p.status === 'pending' ? (
        <div className="proposal-actions">
          <button type="button" className="btn proposal-allow" onClick={() => onDecide(true)}>
            Allow
          </button>
          <button type="button" className="btn btn-quiet proposal-deny" onClick={() => onDecide(false)}>
            Deny
          </button>
        </div>
      ) : (
        <p className="proposal-done">{p.status === 'allowed' ? '✓ Allowed. It is now “Your plan” on the card.' : '✕ Denied. Nothing changed.'}</p>
      )}
    </div>
  )
}

function AssistantTurn({ turn, onDecide }: { turn: ChatTurn; onDecide: (id: string, allowed: boolean) => void }) {
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
      {!turn.text && turn.status === 'working' && !turn.proposals?.length && <p className="msg-thinking">Thinking…</p>}
      {/* Text and proposal cards in the order they came: text before the proposal, the card, text after. */}
      {[...(turn.proposals ?? []), null].map((p, i, all) => {
        const from = i === 0 ? 0 : (all[i - 1]?.textAt ?? 0)
        const part = turn.text.slice(from, p ? p.textAt : undefined).trim()
        return (
          <div key={p?.id ?? 'end'}>
            {part && (
              <div className="msg-text">
                <Formatted text={part} ledger={ledger} />
              </div>
            )}
            {p && <ProposalCard p={p} onDecide={(allowed) => onDecide(p.id, allowed)} />}
          </div>
        )
      })}
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

/** A question the page asks on the farmer's behalf (e.g. "Review this plan"). */
export interface AgentRequest {
  id: number
  text: string
}

/** "Ask about your plan": a drawer where the farmer discusses the plans with a grounded agent. */
export function AgentPanel(props: {
  getContext: () => AgentContext | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The plan open on the card, shown as "Talking about". */
  viewingTitle: string
  request: AgentRequest | null
}) {
  const { getContext, open, request } = props
  const setOpen = props.onOpenChange
  const [draft, setDraft] = useState('')
  const { turns, busy, waitingForYou, ask, stop, reset, decide } = useAgent(getContext)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const handled = useRef(0)

  useEffect(() => {
    if (!request || request.id === handled.current || busy) return
    handled.current = request.id
    void ask(request.text)
  }, [request, busy, ask])

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
              <p className="agent-about">
                Talking about: <strong>{props.viewingTitle}</strong>
                <span className="small muted"> · pick another plan on the card to switch</span>
              </p>
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
                  {t.about && <span className="msg-about">About: {t.about}</span>}
                  {t.text}
                </div>
              ) : (
                <AssistantTurn key={t.id} turn={t} onDecide={decide} />
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
              placeholder={waitingForYou ? 'Allow or deny the change above first…' : 'Ask a question… / Escribe tu pregunta…'}
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

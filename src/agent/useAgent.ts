import type Anthropic from '@anthropic-ai/sdk'
import { useCallback, useRef, useState } from 'react'
import { addToLedger, checkAnswer, type GroundingReport, type Ledger } from './grounding'
import { PLAIN_TITLE } from '../tool/plans'
import { runTool, type AgentContext, type Proposal } from './toolHandlers'

/** Tool rounds allowed per question before the agent must answer. */
export const MAX_TOOL_ROUNDS = 8

export interface ChatStep {
  summary: string
  isError: boolean
}

export type ProposalStatus = 'pending' | 'allowed' | 'denied'
export interface ChatProposal extends Proposal {
  status: ProposalStatus
  /** Where in the answer text the proposal appeared, so the card shows in reading order. */
  textAt: number
}

export interface ChatTurn {
  id: number
  role: 'user' | 'assistant'
  text: string
  /** User turns: the plan the farmer had open when asking. */
  about?: string
  /** Assistant turns: changes the helper proposed in this answer. */
  proposals?: ChatProposal[]
  steps: ChatStep[]
  sources: string[]
  status: 'working' | 'done' | 'error'
  report?: GroundingReport
  /** Every number the tools had returned when this answer finished (for marking the answer). */
  ledger?: Ledger
  error?: { kind: string; message: string }
}

type MessageParam = Anthropic.Beta.BetaMessageParam
type Message = Anthropic.Beta.BetaMessage

class AgentError extends Error {
  kind: string
  constructor(kind: string, message: string) {
    super(message)
    this.kind = kind
  }
}

/** The app's note in front of each question, so the helper knows which plan is on screen. */
export function screenNote(ctx: AgentContext): string {
  const mine = ctx.yours ? ` The farmer also has "Your plan" (option yours), edited from "${PLAIN_TITLE[ctx.yours.from]}".` : ''
  return `[On screen: the farmer is looking at "${PLAIN_TITLE[ctx.viewing]}" (option ${ctx.viewing}).${mine}]`
}

/** One Messages API call through the local server, streaming text deltas. */
async function callServer(messages: MessageParam[], onDelta: (t: string) => void, signal: AbortSignal): Promise<Message> {
  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  })
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null)
    throw new AgentError('api', (body as { error?: string } | null)?.error ?? `The assistant server returned ${res.status}.`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let final: Message | null = null
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const event = /^event: (.*)$/m.exec(chunk)?.[1]
      const data = /^data: (.*)$/m.exec(chunk)?.[1]
      if (!event || !data) continue
      const payload = JSON.parse(data)
      if (event === 'text') onDelta(payload.delta as string)
      else if (event === 'message') final = payload as Message
      else if (event === 'error') throw new AgentError(payload.kind, payload.message)
    }
  }
  if (!final) throw new AgentError('api', 'The connection to the assistant closed early. Please try again.')
  return final
}

/**
 * The planning agent's loop. Runs in the browser because the tools need the engine state here;
 * the server only relays each API call. History is rolled back if a question fails half-way, so
 * the conversation never holds a tool call without its result.
 */
export function useAgent(getContext: () => AgentContext | null) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [busy, setBusy] = useState(false)
  const history = useRef<MessageParam[]>([])
  const ledger = useRef<Ledger>([])
  const abort = useRef<AbortController | null>(null)
  const nextId = useRef(0)
  /** Pending Allow/Deny decisions, by proposal id. */
  const waiting = useRef(new Map<string, (allowed: boolean) => void>())

  const update = (id: number, fn: (t: ChatTurn) => ChatTurn) => setTurns((all) => all.map((t) => (t.id === id ? fn(t) : t)))

  const ask = useCallback(async (question: string) => {
    const q = question.trim()
    const ctx0 = getContext()
    if (!q || !ctx0) return
    const ctrl = new AbortController()
    abort.current = ctrl
    const checkpoint = history.current.length
    const userId = ++nextId.current
    const id = ++nextId.current
    setTurns((all) => [
      ...all,
      { id: userId, role: 'user', text: q, about: PLAIN_TITLE[ctx0.viewing], steps: [], sources: [], status: 'done' },
      { id, role: 'assistant', text: '', steps: [], sources: [], proposals: [], status: 'working' },
    ])
    setBusy(true)
    history.current.push({
      role: 'user',
      content: [
        { type: 'text', text: screenNote(ctx0) },
        { type: 'text', text: q },
      ],
    })

    // propose_change waits here until the farmer taps Allow or Deny (or stops the question).
    const requestApproval = (p: Proposal) =>
      new Promise<boolean>((resolve) => {
        if (ctrl.signal.aborted) return resolve(false)
        waiting.current.set(p.id, resolve)
        update(id, (t) => ({ ...t, proposals: [...(t.proposals ?? []), { ...p, status: 'pending', textAt: text.length }] }))
      })

    let text = ''
    let roundText = ''
    const onDelta = (d: string) => {
      if (!roundText && text) text += '\n\n'
      roundText += d
      text += d
      update(id, (t) => ({ ...t, text }))
    }
    try {
      let rounds = 0
      for (;;) {
        roundText = ''
        const msg = await callServer(history.current, onDelta, ctrl.signal)
        // Echo the full content back (thinking, tool_use, fallback blocks) as the API requires.
        history.current.push({ role: 'assistant', content: msg.content as unknown as Anthropic.Beta.BetaContentBlockParam[] })
        if (msg.stop_reason === 'pause_turn') continue
        if (msg.stop_reason === 'refusal') {
          onDelta('I can’t help with that one. Please ask your agronomist. / No puedo ayudar con eso; pregúntale a tu agrónomo.')
          break
        }
        if (msg.stop_reason === 'max_tokens') throw new AgentError('api', 'The answer got too long. Try a narrower question.')
        const calls = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
        if (calls.length === 0) break
        if (rounds++ >= MAX_TOOL_ROUNDS) {
          if (rounds > MAX_TOOL_ROUNDS + 1) throw new AgentError('api', 'The assistant kept checking without answering. Try asking more simply.')
          // Answer the pending calls so history stays valid, and ask for a final answer.
          history.current.push({
            role: 'user',
            content: [
              ...calls.map((c) => ({ type: 'tool_result' as const, tool_use_id: c.id, is_error: true, content: 'Tool limit reached for this question.' })),
              { type: 'text' as const, text: 'Please answer now with what you have, or say what is missing.' },
            ],
          })
          continue
        }
        const ctx = { ...(getContext() ?? ctx0), requestApproval }
        const outputs = await Promise.all(calls.map((c) => runTool(c.name, c.input, ctx)))
        if (ctrl.signal.aborted) throw new AgentError('stopped', 'Stopped.')
        outputs.forEach((o) => {
          if (!o.isError) addToLedger(ledger.current, o.content)
        })
        update(id, (t) => ({
          ...t,
          steps: [...t.steps, ...outputs.map((o) => ({ summary: o.summary, isError: o.isError }))],
          sources: [...new Set([...t.sources, ...outputs.flatMap((o) => o.sources)])],
        }))
        history.current.push({
          role: 'user',
          content: outputs.map((o, k) => ({ type: 'tool_result' as const, tool_use_id: calls[k].id, content: o.content, is_error: o.isError })),
        })
      }
      const snapshot = [...ledger.current]
      update(id, (t) => ({ ...t, status: 'done', report: checkAnswer(text, snapshot), ledger: snapshot }))
    } catch (e) {
      history.current.length = checkpoint
      if (ctrl.signal.aborted) {
        update(id, (t) => ({ ...t, status: 'error', error: { kind: 'stopped', message: 'Stopped.' } }))
      } else {
        const err = e instanceof AgentError ? e : new AgentError('api', (e as Error).message)
        update(id, (t) => ({ ...t, status: 'error', error: { kind: err.kind, message: err.message } }))
      }
    } finally {
      setBusy(false)
      abort.current = null
    }
  }, [getContext])

  /** The farmer's answer to a proposal. */
  const decide = useCallback((proposalId: string, allowed: boolean) => {
    const resolve = waiting.current.get(proposalId)
    if (!resolve) return
    waiting.current.delete(proposalId)
    const status: ProposalStatus = allowed ? 'allowed' : 'denied'
    setTurns((all) => all.map((t) => (t.proposals?.some((p) => p.id === proposalId) ? { ...t, proposals: t.proposals.map((p) => (p.id === proposalId ? { ...p, status } : p)) } : t)))
    resolve(allowed)
  }, [])

  /** Stopping counts as "no" for any change still waiting. */
  const denyPending = useCallback(() => {
    for (const pid of [...waiting.current.keys()]) decide(pid, false)
  }, [decide])

  const stop = useCallback(() => {
    abort.current?.abort()
    denyPending()
  }, [denyPending])
  const reset = useCallback(() => {
    abort.current?.abort()
    denyPending()
    history.current = []
    ledger.current = []
    setTurns([])
  }, [denyPending])

  const waitingForYou = turns.some((t) => t.proposals?.some((p) => p.status === 'pending'))
  return { turns, busy, waitingForYou, ask, stop, reset, decide }
}

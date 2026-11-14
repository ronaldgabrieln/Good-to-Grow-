// Local endpoint for the planning agent: POST /api/agent, streamed back as Server-Sent Events.
//
// The browser runs the agent loop (its tools need the engine state that lives there) and sends only
// the conversation `messages`. This server holds the API key and fixes everything else - model,
// system prompt, tools and limits - so a page can't change what the agent is or which key it uses.
// Added to both `vite` (dev) and `vite preview` (npm run serve). Local use only: no auth.

import Anthropic from '@anthropic-ai/sdk'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { SYSTEM_PROMPT } from '../src/agent/systemPrompt'
import { AGENT_TOOLS } from '../src/agent/toolDefs'

const MODEL = 'claude-opus-5-5'
const MAX_BODY_BYTES = 600_000
const MAX_MESSAGES = 120

type Send = (event: 'text' | 'message' | 'error', data: unknown) => void

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Conversation too long; start a new one.'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Only user/assistant turns from the browser; no system messages or other request fields. */
function validMessages(body: unknown): Anthropic.Beta.BetaMessageParam[] | null {
  const messages = (body as { messages?: unknown })?.messages
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return null
  for (const m of messages) {
    if (!m || typeof m !== 'object') return null
    const { role, content } = m as { role?: unknown; content?: unknown }
    if (role !== 'user' && role !== 'assistant') return null
    if (typeof content !== 'string' && !Array.isArray(content)) return null
  }
  if ((messages[0] as { role: string }).role !== 'user') return null
  return messages as Anthropic.Beta.BetaMessageParam[]
}

export function agentPlugin(options: { apiKey?: string } = {}): Plugin {
  let client: Anthropic | null = null
  const getClient = () => (client ??= new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {}))

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }
    let messages: Anthropic.Beta.BetaMessageParam[] | null
    try {
      messages = validMessages(JSON.parse(await readBody(req)))
    } catch {
      messages = null
    }
    if (!messages) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Invalid conversation.' }))
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const send: Send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

    let stream: ReturnType<Anthropic['beta']['messages']['stream']> | null = null
    // The browser went away (closed the panel, pressed Stop): stop generating. Note: the *request*
    // 'close' event fires once the body is read, so the response is the one to watch.
    let clientGone = false
    res.on('close', () => {
      if (!res.writableFinished) {
        clientGone = true
        stream?.abort()
      }
    })
    try {
      stream = getClient().beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        // A refused turn is re-run on a fallback model chosen by the API instead of just stopping.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        // System prompt and tools never change, so the prefix is cached across turns.
        cache_control: { type: 'ephemeral' },
        system: SYSTEM_PROMPT,
        tools: AGENT_TOOLS,
        messages,
      })
      stream.on('text', (delta: string) => send('text', { delta }))
      const message = await stream.finalMessage()
      const u = message.usage
      console.log(
        `[agent] ${message.stop_reason} · in ${u.input_tokens} (cache read ${u.cache_read_input_tokens ?? 0}, write ${u.cache_creation_input_tokens ?? 0}) · out ${u.output_tokens}`,
      )
      send('message', message)
    } catch (err) {
      if (clientGone) return
      let kind = 'api'
      let text = 'The assistant had a problem. Please try again.'
      if (err instanceof Anthropic.AuthenticationError || (err instanceof Error && /api[_ ]?key|credential|auth/i.test(err.message) && !(err instanceof Anthropic.APIError))) {
        kind = 'not_configured'
        text = 'The assistant is not set up: add ANTHROPIC_API_KEY to a .env file and restart the server.'
      } else if (err instanceof Anthropic.RateLimitError) {
        text = 'The assistant is busy right now. Wait a moment and try again.'
      } else if (err instanceof Anthropic.APIConnectionError) {
        text = 'Could not reach the assistant service. Check the internet connection.'
      } else if (err instanceof Anthropic.APIError) {
        text = `The assistant service returned an error (${err.status ?? 'unknown'}).`
      }
      console.error('[agent]', err)
      send('error', { kind, message: text })
    } finally {
      res.end()
    }
  }

  // Must return nothing: Vite treats a function returned from configureServer as a post-middleware hook.
  const mount = (server: { middlewares: { use: (path: string, fn: (req: IncomingMessage, res: ServerResponse) => void) => unknown } }) => {
    server.middlewares.use('/api/agent', (req, res) => void handle(req, res))
  }

  return {
    name: 'goodtogrow-agent',
    configureServer: mount,
    configurePreviewServer: mount,
  }
}

// The planning agent's endpoint: POST /api/agent, streamed back as Server-Sent Events.
//
// The browser runs the agent loop (its tools need the engine state that lives there) and sends only
// the conversation `messages`. This server holds the API key and fixes everything else - model,
// system prompt, tools and limits - so a page can't change what the agent is or which key it uses.
// Used by the Vite dev/preview plugin (server/agentPlugin.ts) and the Vercel function (api/agent.ts).
// No auth: anyone who can reach the endpoint can spend the key, so set a spend limit on it.
//
// Relative imports on this path end in .js: on Vercel this file runs as plain Node ESM, which needs
// real extensions (Vite and Vitest map them back to the .ts sources).

import Anthropic from '@anthropic-ai/sdk'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SYSTEM_PROMPT } from '../src/agent/systemPrompt.js'
import { AGENT_TOOLS } from '../src/agent/toolDefs.js'

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

export interface AgentHandlerOptions {
  apiKey?: string
  /**
   * Read the JSON body. Defaults to reading the raw request stream; Vercel's runtime has already
   * parsed it into `req.body`, so the function passes that instead.
   */
  readJson?: (req: IncomingMessage) => Promise<unknown>
}

const readJsonStream = async (req: IncomingMessage) => JSON.parse(await readBody(req)) as unknown

export function createAgentHandler(options: AgentHandlerOptions = {}) {
  let client: Anthropic | null = null
  const getClient = () => (client ??= new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {}))
  const readJson = options.readJson ?? readJsonStream

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }
    let messages: Anthropic.Beta.BetaMessageParam[] | null
    try {
      const body = await readJson(req)
      messages = JSON.stringify(body ?? null).length > MAX_BODY_BYTES ? null : validMessages(body)
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
        text = 'The assistant is not set up: set ANTHROPIC_API_KEY (in .env locally, or in the hosting provider’s environment variables) and restart or redeploy.'
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

  return handle
}

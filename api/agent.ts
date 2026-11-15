// Vercel serverless function for the planning agent: POST /api/agent (Server-Sent Events).
// Same handler as the local Vite plugin; the key comes from the project's ANTHROPIC_API_KEY.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createAgentHandler } from '../server/agentHandler.js'

const handle = createAgentHandler({
  apiKey: process.env.ANTHROPIC_API_KEY || undefined,
  // Vercel's Node runtime has already parsed the JSON body into req.body.
  readJson: async (req) => (req as IncomingMessage & { body?: unknown }).body,
})

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handle(req, res)
}

// Local endpoint for the planning agent in `vite` (dev) and `vite preview` (npm run serve).
// The request handling lives in agentHandler.ts, shared with the Vercel function (api/agent.ts).
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { createAgentHandler } from './agentHandler'

export function agentPlugin(options: { apiKey?: string } = {}): Plugin {
  const handle = createAgentHandler({ apiKey: options.apiKey })

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

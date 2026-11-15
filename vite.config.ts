import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { agentPlugin } from './server/agentPlugin'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Server-only secrets from .env (not exposed to the browser: no VITE_ prefix).
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), agentPlugin({ apiKey: env.ANTHROPIC_API_KEY || undefined })],
  }
})

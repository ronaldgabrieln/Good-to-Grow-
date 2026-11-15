// Supabase client for farmer profiles. Browser-only: the anon key is public by design, and the
// tables' row-level-security policies decide what it may do (see supabase/schema.sql).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Memory, Profile, SavedStrategy, SavedStrategyPayload } from './types'

// Forgiving about how the settings were pasted: stray spaces or quotes, a trailing slash, or the
// REST path copied with the URL. Either key name works (Supabase now calls it "publishable").
const clean = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/^["']|["']$/g, '').trim() : '')
const url = clean(import.meta.env.VITE_SUPABASE_URL).replace(/\/(rest\/v1)?\/?$/, '')
const key = clean(import.meta.env.VITE_SUPABASE_ANON_KEY) || clean(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)

/** False when .env has no Supabase settings: the app then works without profiles. */
export const profilesConfigured = Boolean(url && key)

/** What the build was given, without the secret part: for the profile drawer's "Connection" line. */
export const connectionInfo = {
  host: url ? url.replace(/^https?:\/\//, '') : '(missing VITE_SUPABASE_URL)',
  keyKind: !key ? '(missing key)' : key.startsWith('sb_publishable_') ? 'publishable key' : key.startsWith('eyJ') ? 'anon key' : key.startsWith('sb_secret_') ? 'SECRET key: replace it with the publishable key' : 'unrecognized key',
}

let client: SupabaseClient | null = null
function db(): SupabaseClient {
  if (!profilesConfigured) throw new Error('Profiles are not set up: add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.')
  // No Supabase Auth in the demo (username only), so there is no session to keep.
  client ??= createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}

/** Lowercase, trimmed; 3–32 of a-z 0-9 _ . - and starting with a letter or digit (matches the table check). */
export function normalizeUsername(raw: string): string | null {
  const u = raw.trim().toLowerCase()
  return /^[a-z0-9][a-z0-9_.-]{2,31}$/.test(u) ? u : null
}

/** Turn Supabase errors into a sentence that says what to fix. */
function fail(what: string, error: { message: string; code?: string } | null): never {
  const msg = error?.message ?? 'unknown error'
  const code = error?.code ?? ''
  if (code === 'PGRST205' || code === '42P01' || /relation .* does not exist|schema cache|could not find the table/i.test(msg))
    throw new Error(`${what}: the profile tables are missing. Run supabase/schema.sql in the Supabase SQL Editor.`)
  if (code === '42501' || /row-level security|permission denied/i.test(msg))
    throw new Error(`${what}: the database refused it (row-level security). Run supabase/schema.sql again: it creates the access rules.`)
  if (/invalid api key|no api key|jwt|legacy api keys/i.test(msg))
    throw new Error(`${what}: Supabase did not accept the key (${msg}). Copy the anon or publishable key from Project Settings → API into VITE_SUPABASE_ANON_KEY and redeploy.`)
  if (/failed to fetch|networkerror|load failed/i.test(msg))
    throw new Error(`${what}: could not reach ${connectionInfo.host}. Check VITE_SUPABASE_URL (it should look like https://<project>.supabase.co) and that the project is not paused.`)
  throw new Error(`${what}: ${msg}${code ? ` (${code})` : ''}`)
}

/** Find the profile with this username, or create it. */
export async function signInWithUsername(username: string): Promise<Profile> {
  const { data, error } = await db()
    .from('profiles')
    .upsert({ username, last_seen_at: new Date().toISOString() }, { onConflict: 'username' })
    .select('id, username, created_at')
    .single()
  if (error || !data) fail('Could not sign in', error)
  return data as Profile
}

export async function listStrategies(profileId: string): Promise<SavedStrategy[]> {
  const { data, error } = await db().from('strategies').select('*').eq('profile_id', profileId).order('created_at', { ascending: false }).limit(100)
  if (error) fail('Could not load saved plans', error)
  return (data ?? []) as SavedStrategy[]
}

export async function insertStrategy(profileId: string, title: string, payload: SavedStrategyPayload): Promise<SavedStrategy> {
  const { data, error } = await db()
    .from('strategies')
    .insert({
      profile_id: profileId,
      title,
      plan_key: payload.plan.key,
      field_name: payload.field.name,
      lat: payload.field.lat,
      lon: payload.field.lon,
      payload,
    })
    .select('*')
    .single()
  if (error || !data) fail('Could not save the plan', error)
  return data as SavedStrategy
}

export async function removeStrategy(id: string): Promise<void> {
  const { error } = await db().from('strategies').delete().eq('id', id)
  if (error) fail('Could not delete the plan', error)
}

export async function listMemories(profileId: string): Promise<Memory[]> {
  const { data, error } = await db().from('memories').select('*').eq('profile_id', profileId).order('created_at', { ascending: true }).limit(200)
  if (error) fail('Could not load the helper’s memory', error)
  return (data ?? []) as Memory[]
}

export async function insertMemory(profileId: string, fact: string, source: Memory['source']): Promise<Memory> {
  const { data, error } = await db().from('memories').insert({ profile_id: profileId, fact, source }).select('*').single()
  if (error || !data) fail('Could not save to memory', error)
  return data as Memory
}

export async function removeMemory(id: string): Promise<void> {
  const { error } = await db().from('memories').delete().eq('id', id)
  if (error) fail('Could not delete from memory', error)
}

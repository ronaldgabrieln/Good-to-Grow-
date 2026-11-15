// Supabase client for farmer profiles. Browser-only: the anon key is public by design, and the
// tables' row-level-security policies decide what it may do (see supabase/schema.sql).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Memory, Profile, SavedStrategy, SavedStrategyPayload } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** False when .env has no Supabase settings: the app then works without profiles. */
export const profilesConfigured = Boolean(url && key)

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

function fail(what: string, error: { message: string } | null): never {
  const msg = error?.message ?? 'unknown error'
  if (/relation .* does not exist|schema cache/i.test(msg)) throw new Error(`${what}: the profile tables are missing. Run supabase/schema.sql in the Supabase SQL editor.`)
  throw new Error(`${what}: ${msg}`)
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

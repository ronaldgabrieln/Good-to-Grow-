import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ProfileContext, type ProfileState } from './ProfileContext'
import {
  insertMemory, insertStrategy, listMemories, listStrategies, normalizeUsername, profilesConfigured,
  removeMemory, removeStrategy, signInWithUsername,
} from './supabase'
import type { Memory, Profile, SavedStrategy } from './types'

const STORAGE_KEY = 'goodtogrow:username'

function readStoredUsername(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}
function storeUsername(u: string | null) {
  try {
    if (u) localStorage.setItem(STORAGE_KEY, u)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Remembering the username on this device is a convenience only.
  }
}

/** Holds the signed-in farmer (username only, see supabase/schema.sql) and keeps their lists in sync. */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [strategies, setStrategies] = useState<SavedStrategy[]>([])
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (username: string) => {
    setLoading(true)
    setError(null)
    try {
      const p = await signInWithUsername(username)
      const [s, m] = await Promise.all([listStrategies(p.id), listMemories(p.id)])
      setProfile(p)
      setStrategies(s)
      setMemories(m)
      storeUsername(p.username)
    } catch (e) {
      setError((e as Error).message)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  // Come back signed in on this device.
  useEffect(() => {
    const u = profilesConfigured ? readStoredUsername() : null
    if (!u) return
    let live = true
    void Promise.resolve().then(() => (live ? load(u).catch(() => storeUsername(null)) : undefined))
    return () => {
      live = false
    }
  }, [load])

  const signIn = useCallback(async (raw: string) => {
    const u = normalizeUsername(raw)
    if (!u) {
      const msg = 'Use 3–32 letters, numbers, dots, dashes or underscores (no spaces).'
      setError(msg)
      throw new Error(msg)
    }
    await load(u)
  }, [load])

  const signOut = useCallback(() => {
    storeUsername(null)
    setProfile(null)
    setStrategies([])
    setMemories([])
    setError(null)
  }, [])

  const requireProfile = useCallback(() => {
    if (!profile) throw new Error('Sign in with your username first.')
    return profile
  }, [profile])

  const value = useMemo<ProfileState>(() => ({
    configured: profilesConfigured,
    profile,
    strategies,
    memories,
    loading,
    error,
    signIn,
    signOut,
    saveStrategy: async (title, payload) => {
      const s = await insertStrategy(requireProfile().id, title, payload)
      setStrategies((all) => [s, ...all])
      return s
    },
    deleteStrategy: async (id) => {
      await removeStrategy(id)
      setStrategies((all) => all.filter((s) => s.id !== id))
    },
    addMemory: async (fact, source) => {
      const m = await insertMemory(requireProfile().id, fact, source)
      setMemories((all) => [...all, m])
      return m
    },
    deleteMemory: async (id) => {
      await removeMemory(id)
      setMemories((all) => all.filter((m) => m.id !== id))
    },
  }), [profile, strategies, memories, loading, error, signIn, signOut, requireProfile])

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

// The signed-in farmer, their saved plans and the helper's memory, shared across the planner.
import { createContext, useContext } from 'react'
import type { Memory, Profile, SavedStrategy, SavedStrategyPayload } from './types'

export interface ProfileState {
  /** False when Supabase is not set up in .env; every profile feature then hides itself. */
  configured: boolean
  profile: Profile | null
  strategies: SavedStrategy[]
  memories: Memory[]
  loading: boolean
  error: string | null
  signIn: (username: string) => Promise<void>
  signOut: () => void
  saveStrategy: (title: string, payload: SavedStrategyPayload) => Promise<SavedStrategy>
  deleteStrategy: (id: string) => Promise<void>
  addMemory: (fact: string, source: Memory['source']) => Promise<Memory>
  deleteMemory: (id: string) => Promise<void>
}

const missing = async () => {
  throw new Error('Profiles are not available here.')
}

export const ProfileContext = createContext<ProfileState>({
  configured: false,
  profile: null,
  strategies: [],
  memories: [],
  loading: false,
  error: null,
  signIn: missing,
  signOut: () => {},
  saveStrategy: missing,
  deleteStrategy: missing,
  addMemory: missing,
  deleteMemory: missing,
})

export const useProfile = () => useContext(ProfileContext)

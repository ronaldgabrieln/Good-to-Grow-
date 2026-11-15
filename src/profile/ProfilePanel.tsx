// "My farm profile": sign in with a username, see saved plans (open, PDF, delete) and what the
// planning helper remembers. A drawer on the results screen, next to the helper's.
import { useState } from 'react'
import { useProfile } from './ProfileContext'
import { downloadStrategyPdf } from './strategyPdf'
import { connectionInfo } from './supabase'
import type { SavedStrategy } from './types'
import './profile.css'
import signInImg from '../assets/sign_in.svg'

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const fmtNum = (v: number, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })

/** The header button: "Sign in" or the farmer's username. */
export function ProfileButton({ onClick }: { onClick: () => void }) {
  const { configured, profile } = useProfile()
  if (!configured) return null
  // Signed out: the crumpled-paper "sign in" button, sized like "change field" and "home" beside it.
  if (!profile)
    return (
      <button type="button" className="home-btn bar-signin" onClick={onClick} aria-label="Sign in to save your plans">
        <img src={signInImg} alt="Sign in" />
      </button>
    )
  return (
    <button type="button" className="profile-btn" onClick={onClick} aria-label={profile ? `Your profile: ${profile.username}` : 'Sign in to save your plans'}>
      <span className="profile-avatar" aria-hidden>{profile ? profile.username[0].toUpperCase() : '?'}</span>
      <span>{profile ? profile.username : 'Sign in'}</span>
    </button>
  )
}

export function SignInForm({ intro }: { intro?: string }) {
  const { signIn, loading, error } = useProfile()
  const [name, setName] = useState('')
  return (
    <form className="profile-signin" onSubmit={(e) => { e.preventDefault(); signIn(name).catch(() => {}) }}>
      {intro && <p>{intro}</p>}
      <label htmlFor="profile-username">Your username</label>
      <div className="profile-row">
        <input id="profile-username" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. rancho-ramirez" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32} />
        <button type="submit" className="btn" disabled={loading || name.trim().length < 3}>{loading ? 'Signing in…' : 'Sign in'}</button>
      </div>
      <p className="small muted">New username? A profile is made for it. Anyone who knows your username can open it, so don’t use your real name.</p>
      {error && <p className="profile-error">{error}</p>}
      {error && <p className="small muted">Supabase project: {connectionInfo.host} · {connectionInfo.keyKind}</p>}
    </form>
  )
}

function SavedRow({ s, onOpen }: { s: SavedStrategy; onOpen?: (s: SavedStrategy) => void }) {
  const { deleteStrategy, profile } = useProfile()
  const [busy, setBusy] = useState<'pdf' | 'delete' | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const p = s.payload
  const base = p.plan.baseMetrics
  const water = base && base.waterMm > 0 ? ((p.plan.metrics.waterMm - base.waterMm) / base.waterMm) * 100 : null
  const run = async (kind: 'pdf' | 'delete', fn: () => Promise<void>) => {
    setBusy(kind)
    setErr(null)
    try { await fn() } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  return (
    <li className="saved">
      <div className="saved-h">
        <b>{s.title}</b>
        <span className="small muted">{fmtDate(s.created_at)} · {s.field_name ?? `${fmtNum(s.lat, 3)}, ${fmtNum(s.lon, 3)}`}</span>
      </div>
      <p className="saved-rot">{p.plan.label || 'Nothing planted'}</p>
      <p className="small">
        {fmtNum(p.plan.metrics.waterMm * 10)} m³/ha of irrigation a year
        {water !== null && Math.abs(water) >= 3 ? ` (${fmtNum(Math.abs(water))}% ${water < 0 ? 'less' : 'more'} than what you plant now)` : ''}
      </p>
      <div className="saved-actions">
        {onOpen && <button type="button" className="btn btn-quiet" onClick={() => onOpen(s)}>Open again</button>}
        <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => run('pdf', () => downloadStrategyPdf(p, { title: s.title, username: profile?.username }))}>
          {busy === 'pdf' ? 'Making PDF…' : 'Download PDF'}
        </button>
        {confirm ? (
          <>
            <button type="button" className="btn profile-danger" disabled={busy !== null} onClick={() => run('delete', () => deleteStrategy(s.id))}>{busy === 'delete' ? 'Deleting…' : 'Delete for good'}</button>
            <button type="button" className="agent-link" onClick={() => setConfirm(false)}>Keep it</button>
          </>
        ) : (
          <button type="button" className="agent-link" onClick={() => setConfirm(true)}>Delete</button>
        )}
      </div>
      {err && <p className="profile-error">{err}</p>}
    </li>
  )
}

export function ProfilePanel({ open, onClose, onOpenSaved }: { open: boolean; onClose: () => void; onOpenSaved?: (s: SavedStrategy) => void }) {
  const { profile, strategies, memories, signOut, deleteMemory, addMemory } = useProfile()
  const [note, setNote] = useState('')
  const [noteErr, setNoteErr] = useState<string | null>(null)
  if (!open) return null
  return (
    <aside className="profile-panel agent" aria-label="Your farm profile">
      <header className="agent-head">
        <div>
          <h2>{profile ? `Hi, ${profile.username}` : 'Your farm profile'}</h2>
          <p className="small muted">Saved plans and what the helper remembers about your farm.</p>
        </div>
        {profile && <button type="button" className="agent-link" onClick={signOut}>Sign out</button>}
        <button type="button" className="agent-close" aria-label="Close" onClick={onClose}>×</button>
      </header>
      <div className="agent-log profile-body">
        {!profile ? (
          <SignInForm intro="Sign in to save plans, open them again later and download them as a PDF for your agronomist." />
        ) : (
          <>
            <section>
              <h3>Saved plans ({strategies.length})</h3>
              {strategies.length === 0 ? (
                <p className="small muted">Nothing saved yet. Use “Save this plan” on the card.</p>
              ) : (
                <ul className="saved-list">{strategies.map((s) => <SavedRow key={s.id} s={s} onOpen={onOpenSaved} />)}</ul>
              )}
            </section>
            <section>
              <h3>What the helper remembers</h3>
              <p className="small muted">The helper reads this before answering. It only adds something after you tap Allow.</p>
              {memories.length === 0 ? (
                <p className="small muted">Nothing yet.</p>
              ) : (
                <ul className="memory-list">
                  {memories.map((m) => (
                    <li key={m.id}>
                      <span>{m.fact}</span>
                      <button type="button" className="agent-link" onClick={() => deleteMemory(m.id).catch((e: Error) => setNoteErr(e.message))} aria-label={`Forget: ${m.fact}`}>Forget</button>
                    </li>
                  ))}
                </ul>
              )}
              <form className="profile-row" onSubmit={(e) => {
                e.preventDefault()
                const f = note.trim()
                if (!f) return
                setNoteErr(null)
                addMemory(f, 'farmer').then(() => setNote('')).catch((er: Error) => setNoteErr(er.message))
              }}>
                <input id="profile-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Add something yourself, e.g. “my well tested 2.1 dS/m”" aria-label="Add a note for the helper" />
                <button type="submit" className="btn btn-quiet" disabled={!note.trim()}>Add</button>
              </form>
              {noteErr && <p className="profile-error">{noteErr}</p>}
            </section>
          </>
        )}
      </div>
    </aside>
  )
}

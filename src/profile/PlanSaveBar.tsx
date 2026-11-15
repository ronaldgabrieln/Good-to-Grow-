// "Save this plan" and "Download PDF" under the plan on the results card.
import { useState } from 'react'
import { useProfile } from './ProfileContext'
import { defaultTitle } from './snapshot'
import { downloadStrategyPdf } from './strategyPdf'
import type { SavedStrategyPayload } from './types'

export function PlanSaveBar({ getPayload, disabled, onNeedSignIn }: {
  /** Snapshot of the plan on screen, or null while it is still being computed. */
  getPayload: () => SavedStrategyPayload | null
  disabled: boolean
  onNeedSignIn: () => void
}) {
  const { configured, profile, saveStrategy } = useProfile()
  const [title, setTitle] = useState<string | null>(null)
  const [pending, setPending] = useState<SavedStrategyPayload | null>(null)
  const [busy, setBusy] = useState<'save' | 'pdf' | null>(null)
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)

  const startSave = () => {
    setMsg(null)
    if (!profile) {
      onNeedSignIn()
      setMsg({ text: 'Sign in with your username (left), then press Save again.' })
      return
    }
    const p = getPayload()
    if (!p) return
    setPending(p)
    setTitle(defaultTitle(p))
  }
  const confirmSave = async () => {
    if (!pending || !title?.trim()) return
    setBusy('save')
    try {
      await saveStrategy(title.trim().slice(0, 120), pending)
      setMsg({ text: `Saved to ${profile?.username}’s plans ✓` })
      setTitle(null)
      setPending(null)
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true })
    } finally {
      setBusy(null)
    }
  }
  const pdf = async () => {
    const p = getPayload()
    if (!p) return
    setBusy('pdf')
    setMsg(null)
    try {
      await downloadStrategyPdf(p, { title: defaultTitle(p), username: profile?.username })
    } catch (e) {
      setMsg({ text: `Could not make the PDF: ${(e as Error).message}`, error: true })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="plan-save">
      {title !== null ? (
        <form className="plan-save" onSubmit={(e) => { e.preventDefault(); void confirmSave() }}>
          <input id="plan-save-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-label="Name for this saved plan" autoFocus />
          <button type="submit" className="btn" disabled={busy !== null || !title.trim()}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
          <button type="button" className="agent-link" onClick={() => { setTitle(null); setPending(null) }}>Cancel</button>
        </form>
      ) : (
        <>
          {configured && <button type="button" className="btn btn-quiet" disabled={disabled || busy !== null} onClick={startSave}>Save this plan</button>}
          <button type="button" className="btn btn-quiet" disabled={disabled || busy !== null} onClick={() => void pdf()}>{busy === 'pdf' ? 'Making PDF…' : 'Download PDF'}</button>
        </>
      )}
      {msg && <span className={`plan-save-msg${msg.error ? ' is-error' : ''}`} role="status">{msg.text}</span>}
    </div>
  )
}

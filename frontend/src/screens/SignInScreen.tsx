import { motion } from 'framer-motion'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { ApiError, signIn } from '../api/rejox'
import { Button } from '../components/ui/Button'
import { Panel } from '../components/ui/Panel'
import { DUR, HOUSE_EASE } from '../lib/motion'

interface SignInScreenProps {
  /** Called once a session cookie has been established. */
  onSignedIn: () => void
}

/**
 * The invite-code gate. The code is exchanged at /api/session for an httpOnly
 * cookie, so it is never stored here — this component holds it only for as long
 * as the user is typing it, and never writes it anywhere that survives.
 */
export function SignInScreen({ onSignedIn }: SignInScreenProps) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!code.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await signIn(code.trim())
      setCode('')
      onSignedIn()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: DUR.enter, ease: HOUSE_EASE } }}
      className="mx-auto w-full max-w-md"
    >
      <Panel
        eyebrow="ACCESS"
        title="Enter your invite code"
        description="Rejox runs the code you upload, so access is by invitation while it is in preview."
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="invite-code" className="text-[13px] text-ink-2">
              Invite code
            </label>
            <input
              id="invite-code"
              type="password"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
              aria-invalid={error !== null}
              aria-describedby={error ? 'invite-error' : undefined}
              className="h-10 rounded-full bg-surface-2 px-4 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink-2 disabled:opacity-60"
            />
          </div>

          {error && (
            <p id="invite-error" role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" disabled={busy || !code.trim()}>
            {busy ? 'Checking…' : 'Continue'}
          </Button>
        </form>
      </Panel>
    </motion.div>
  )
}

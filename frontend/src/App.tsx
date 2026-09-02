import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'

import { getSession } from './api/rejox'
import { AppShell } from './components/AppShell'
import { DUR, HOUSE_EASE } from './lib/motion'
import { AnalyzingScreen } from './screens/AnalyzingScreen'
import { AskScreen } from './screens/AskScreen'
import { MigrateScreen } from './screens/MigrateScreen'
import { PlanScreen } from './screens/PlanScreen'
import { ReportScreen } from './screens/ReportScreen'
import { SignInScreen } from './screens/SignInScreen'
import { UploadScreen } from './screens/UploadScreen'
import { usePipelineStore } from './store/pipelineStore'

export default function App() {
  const stage = usePipelineStore((s) => s.stage)
  const reduceMotion = useReducedMotion() === true

  // Three states, never two: until the first /api/session answers we do not
  // know, and rendering the pipeline or the gate on a guess makes the app flash
  // the wrong one. `null` is "not asked yet".
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  const refreshSession = useCallback(() => {
    let cancelled = false
    getSession()
      .then((s) => !cancelled && setSignedIn(s.signedIn))
      // A server with no invite codes configured (an API-key or local server)
      // is not a sign-in problem: let the pipeline through and let the API
      // refuse individual calls if it means to.
      .catch(() => !cancelled && setSignedIn(true))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(refreshSession, [refreshSession])

  // One step transition for the whole pipeline: the outgoing step drops away
  // quickly, the incoming one rises in on the house curve. Every screen gets
  // the same hand-off, so moving between steps reads as one continuous flow
  // rather than six screens swapping places.
  const step = reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: 0 } },
        exit: { opacity: 0, transition: { duration: 0 } },
      }
    : {
        initial: { opacity: 0, y: 8 },
        animate: {
          opacity: 1,
          y: 0,
          transition: { duration: DUR.enter, ease: HOUSE_EASE },
        },
        exit: {
          opacity: 0,
          y: -6,
          transition: { duration: DUR.exit, ease: 'easeIn' as const },
        },
      }

  if (signedIn === null) {
    return <AppShell />
  }

  if (!signedIn) {
    return (
      <AppShell>
        <SignInScreen onSignedIn={() => setSignedIn(true)} />
      </AppShell>
    )
  }

  return (
    <AppShell>
      <AnimatePresence mode="wait">
        <motion.div key={stage} {...step}>
          {stage === 'upload' && <UploadScreen />}
          {stage === 'analyzing' && <AnalyzingScreen />}
          {stage === 'report' && <ReportScreen />}
          {stage === 'plan' && <PlanScreen />}
          {stage === 'ask' && <AskScreen />}
          {stage === 'migrate' && <MigrateScreen />}
        </motion.div>
      </AnimatePresence>
    </AppShell>
  )
}

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

import { AppShell } from './components/AppShell'
import { DUR, HOUSE_EASE } from './lib/motion'
import { AnalyzingScreen } from './screens/AnalyzingScreen'
import { AskScreen } from './screens/AskScreen'
import { MigrateScreen } from './screens/MigrateScreen'
import { PlanScreen } from './screens/PlanScreen'
import { ReportScreen } from './screens/ReportScreen'
import { UploadScreen } from './screens/UploadScreen'
import { usePipelineStore } from './store/pipelineStore'

export default function App() {
  const stage = usePipelineStore((s) => s.stage)
  const reduceMotion = useReducedMotion() === true

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

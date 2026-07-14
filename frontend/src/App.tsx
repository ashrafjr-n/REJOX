import { AnimatePresence, motion } from 'framer-motion'

import { AppShell } from './components/AppShell'
import { AnalyzingScreen } from './screens/AnalyzingScreen'
import { ReportScreen } from './screens/ReportScreen'
import { UploadScreen } from './screens/UploadScreen'
import { usePipelineStore } from './store/pipelineStore'

export default function App() {
  const stage = usePipelineStore((s) => s.stage)

  return (
    <AppShell>
      <AnimatePresence mode="wait">
        <motion.div
          key={stage}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {stage === 'upload' && <UploadScreen />}
          {stage === 'analyzing' && <AnalyzingScreen />}
          {stage === 'report' && <ReportScreen />}
        </motion.div>
      </AnimatePresence>
    </AppShell>
  )
}

import { AnimatePresence, motion } from 'framer-motion'
import { useRef, useState } from 'react'
import type { DragEvent } from 'react'

import { ApiError, uploadGithub, uploadZip } from '../api/rejox'
import { StepHeader } from '../components/StepHeader'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Panel } from '../components/ui/Panel'
import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  FileZipIcon,
  GithubIcon,
  UploadIcon,
} from '../components/icons'
import { cn } from '../lib/cn'
import { formatBytes } from '../lib/display'
import { DUR, HOUSE_EASE } from '../lib/motion'
import { usePipelineStore } from '../store/pipelineStore'
import type { CandidateRoot, IngestedProject } from '../types/api'

// Mirrors the backend ingest guards (backend/app/pipeline/ingest.py defaults).
const LIMITS = {
  maxArchiveBytes: 100 * 1024 * 1024,
  maxUncompressedBytes: 500 * 1024 * 1024,
  maxFileCount: 20_000,
}

function isDefaultCandidate(c: CandidateRoot, ingest: IngestedProject): boolean {
  const norm = (p: string) => p.replace(/\/+$/, '')
  const joined =
    c.path === '.' ? ingest.rootPath : `${norm(ingest.rootPath)}/${c.path}`
  return norm(joined) === norm(ingest.detectedRoot)
}

export function UploadScreen() {
  const ingest = usePipelineStore((s) => s.ingest)
  return (
    <div className="mx-auto max-w-3xl">
      <AnimatePresence mode="wait">
        {ingest ? (
          <motion.div
            key="landed"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: DUR.enter, ease: HOUSE_EASE }}
          >
            <LandedView ingest={ingest} />
          </motion.div>
        ) : (
          <motion.div
            key="input"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: DUR.enter, ease: HOUSE_EASE }}
          >
            <InputView />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// --- Input view: dropzone + GitHub field ------------------------------------

function InputView() {
  const landUpload = usePipelineStore((s) => s.landUpload)
  const [dragActive, setDragActive] = useState(false)
  const [busy, setBusy] = useState<null | 'zip' | 'github'>(null)
  const [error, setError] = useState<string | null>(null)
  const [repoUrl, setRepoUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function submitZip(file: File) {
    setError(null)
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError(`“${file.name}” is not a .zip archive. Upload a zipped React project.`)
      return
    }
    if (file.size > LIMITS.maxArchiveBytes) {
      setError(
        `That archive is ${formatBytes(file.size)} — over the ${formatBytes(LIMITS.maxArchiveBytes)} limit.`,
      )
      return
    }
    setBusy('zip')
    try {
      landUpload(await uploadZip(file))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.')
    } finally {
      setBusy(null)
    }
  }

  async function submitGithub() {
    setError(null)
    const url = repoUrl.trim()
    if (!/^https?:\/\/github\.com\/.+/i.test(url)) {
      setError('Enter a public GitHub URL, e.g. https://github.com/owner/repo.')
      return
    }
    setBusy('github')
    try {
      landUpload(await uploadGithub(url))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Clone failed.')
    } finally {
      setBusy(null)
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void submitZip(file)
  }

  const disabled = busy !== null

  return (
    <div>
      <div className="mb-8">
        <StepHeader
          stage="upload"
          title="Hand Rejox a React codebase."
          description="It builds a deterministic knowledge graph of the project, then reports exactly how much migrates cleanly to React Native — and where genuine reasoning is required."
        />
      </div>

      {/* Dropzone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a ZIP archive"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => !disabled && onDrop(e)}
        className={cn(
          'group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center transition-colors outline-none',
          dragActive
            ? 'border-signal/70 bg-signal/5'
            : 'border-line-strong bg-surface-1 hover:border-ink-4 hover:bg-surface-2/60',
          disabled && 'pointer-events-none opacity-60',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void submitZip(file)
            e.target.value = ''
          }}
        />
        <span
          className={cn(
            'flex h-12 w-12 items-center justify-center rounded-lg border text-[22px] transition-colors',
            dragActive
              ? 'border-signal/50 bg-signal/10 text-signal'
              : 'border-line-strong bg-surface-2 text-ink-3 group-hover:text-signal',
          )}
        >
          {busy === 'zip' ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-signal/30 border-t-signal" />
          ) : (
            <UploadIcon />
          )}
        </span>
        <p className="mt-4 text-[14px] font-medium text-ink">
          {busy === 'zip' ? 'Landing archive…' : 'Drop a .zip, or click to browse'}
        </p>
        <p className="mt-1 text-[12.5px] text-ink-3">
          The project must contain a <code className="font-mono text-ink-2">package.json</code> that
          depends on React.
        </p>
      </div>

      {/* Divider */}
      <div className="my-5 flex items-center gap-4">
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono text-[11px] tracking-widest text-ink-4">OR</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      {/* GitHub */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3">
            <GithubIcon className="text-[17px]" />
          </span>
          <input
            type="url"
            value={repoUrl}
            disabled={disabled}
            onChange={(e) => setRepoUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitGithub()
            }}
            placeholder="https://github.com/owner/repo"
            className="h-10 w-full rounded-lg border border-line-strong bg-surface-1 pr-3 pl-10 text-[14px] text-ink placeholder:text-ink-4 outline-none focus:border-signal/60 focus:ring-2 focus:ring-signal/20 disabled:opacity-60"
          />
        </div>
        <Button
          variant="secondary"
          onClick={() => void submitGithub()}
          disabled={disabled || repoUrl.trim().length === 0}
        >
          {busy === 'github' ? 'Cloning…' : 'Clone'}
        </Button>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: DUR.exit, ease: HOUSE_EASE }}
            className="overflow-hidden"
          >
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger/8 px-3.5 py-3 text-[13px] text-danger">
              <AlertIcon className="mt-0.5 shrink-0 text-[15px]" />
              <span>{error}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Security limits, stated plainly */}
      <div className="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line text-center">
        {[
          { label: 'Max archive', value: formatBytes(LIMITS.maxArchiveBytes) },
          { label: 'Max expanded', value: formatBytes(LIMITS.maxUncompressedBytes) },
          { label: 'Max files', value: LIMITS.maxFileCount.toLocaleString() },
        ].map((l) => (
          <div key={l.label} className="bg-surface-0 px-3 py-3">
            <div className="tnum text-[15px] font-semibold text-ink-2 tabular-nums">
              {l.value}
            </div>
            <div className="eyebrow mt-1">{l.label}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-[11.5px] text-ink-4">
        Uploads are sandboxed per run and guarded against zip bombs. Nothing is
        executed during ingestion.
      </p>
    </div>
  )
}

// --- Landed view: detected root + candidate picker --------------------------

function LandedView({ ingest }: { ingest: IngestedProject }) {
  const reset = usePipelineStore((s) => s.reset)
  const selectedRoot = usePipelineStore((s) => s.selectedRoot)
  const setSelectedRoot = usePipelineStore((s) => s.setSelectedRoot)
  const beginAnalysis = usePipelineStore((s) => s.beginAnalysis)

  // candidateRoots / warnings are optional in the schema (list defaults).
  const candidateRoots = ingest.candidateRoots ?? []
  const warnings = ingest.warnings ?? []
  const multiRoot = candidateRoots.length > 1
  const defaultPath =
    candidateRoots.find((c) => isDefaultCandidate(c, ingest))?.path ?? null
  const activePath = selectedRoot ?? defaultPath

  return (
    <Panel
      eyebrow={<>Ingested · {ingest.source === 'zip' ? 'ZIP archive' : 'GitHub clone'}</>}
      title="React project detected"
      actions={
        <Button variant="ghost" size="sm" onClick={reset}>
          Replace
        </Button>
      }
    >
      <div className="flex items-center gap-3 rounded-lg border border-pos/25 bg-pos/8 px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pos/15 text-pos">
          <CheckIcon className="text-[15px]" />
        </span>
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium text-ink">
            {ingest.fileCount.toLocaleString()} files ·{' '}
            {formatBytes(ingest.sizeBytes)} landed cleanly
          </div>
          <div className="truncate font-mono text-[11.5px] text-ink-3">
            run {ingest.runId}
          </div>
        </div>
      </div>

      {warnings.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {warnings.map((w, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-[12.5px] text-warn"
            >
              <AlertIcon className="mt-0.5 shrink-0 text-[14px]" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Candidate roots */}
      <div className="mt-5">
        <div className="eyebrow mb-2.5">
          {multiRoot ? 'Choose the app to migrate' : 'Project root'}
        </div>
        <div className="space-y-2">
          {candidateRoots.map((c) => {
            const isActive = c.path === activePath
            const isDefault = c.path === defaultPath
            const selectable = multiRoot
            return (
              <button
                key={c.path}
                disabled={!selectable}
                onClick={() => setSelectedRoot(c.path)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
                  isActive
                    ? 'border-signal/50 bg-signal/5'
                    : 'border-line bg-surface-0',
                  selectable && !isActive && 'hover:border-ink-4',
                  !selectable && 'cursor-default',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border',
                    isActive
                      ? 'border-signal/40 bg-signal/10 text-signal'
                      : 'border-line-strong bg-surface-2 text-ink-3',
                  )}
                >
                  <FileZipIcon className="text-[16px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium text-ink">
                      {c.packageName}
                    </span>
                    {isDefault && (
                      <Badge tone="signal">detected</Badge>
                    )}
                  </div>
                  <div className="truncate font-mono text-[11.5px] text-ink-3">
                    {c.path === '.' ? './' : c.path} · react {c.reactVersion}
                  </div>
                </div>
                {selectable && (
                  <span
                    className={cn(
                      'h-4 w-4 shrink-0 rounded-full border-2',
                      isActive
                        ? 'border-signal bg-signal'
                        : 'border-line-strong',
                    )}
                  />
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <Button variant="primary" onClick={beginAnalysis}>
          Analyze project
          <ArrowRightIcon className="text-[16px]" />
        </Button>
      </div>
    </Panel>
  )
}

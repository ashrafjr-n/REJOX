import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { defineConfig, devices } from '@playwright/test'

const dir = path.dirname(fileURLToPath(import.meta.url))

/**
 * E2E config: brings up the REAL stack — the FastAPI backend (:8000) and the
 * Vite dev server (:5173) — then drives a browser against it. The
 * Upload → Analyze → Report path uses no LLM, so we blank GEMINI_API_KEY to
 * prove it runs without one.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/globalSetup.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000',
      cwd: path.resolve(dir, '../backend'),
      url: 'http://127.0.0.1:8000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        // No real key needed; the offline provider makes the one deterministic
        // navigator-shape LLM call, so a migration reports exactly 1 LLM call.
        GEMINI_API_KEY: '',
        REJOX_AI_PROVIDER: 'fake',
        REJOX_CORS_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173',
        // Same local-only posture as dev.sh: this server binds to 127.0.0.1
        // and migrates a fixture we control, so it opts out of the API key and
        // the containment requirement. Never a production setting.
        REJOX_ALLOW_ANONYMOUS: '1',
        REJOX_ALLOW_UNSANDBOXED: '1',
      },
    },
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      cwd: dir,
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        VITE_API_URL: 'http://localhost:8000',
      },
    },
  ],
})

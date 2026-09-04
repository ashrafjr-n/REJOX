import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { defineConfig, devices } from '@playwright/test'

import { INVITE_CODE, SESSION_STATE } from './e2e/session'

const dir = path.dirname(fileURLToPath(import.meta.url))

/**
 * E2E config: brings up the REAL stack — the FastAPI backend (:8000) and the
 * Vite dev server (:5173) — then drives a browser against it. The
 * Upload → Analyze → Report path uses no LLM, so we blank GEMINI_API_KEY to
 * prove it runs without one.
 *
 * The stack is NOT anonymous. Invite codes are configured, so the browser must
 * hold a session cookie exactly as it does in production: `sign-in.spec.ts`
 * drives that gate by hand, and the `setup` project establishes a session for
 * everything else.
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
    // Signs in once, through the real /api/session, and parks the cookie.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: SESSION_STATE },
      dependencies: ['setup'],
      testIgnore: [/auth\.setup\.ts/, /sign-in\.spec\.ts/],
    },
    // The sign-in path itself. No stored session, on purpose: these tests are
    // about a browser that has never signed in.
    {
      name: 'signin',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /sign-in\.spec\.ts/,
    },
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
        // Sessions, so the browser authenticates the way a real one does.
        // Note what this does to the flag below it: `identify()` reaches its
        // anonymous branch only when NEITHER keys nor codes are configured, so
        // with codes set REJOX_ALLOW_ANONYMOUS no longer opens the API. It is
        // still needed for one thing — REJOX_COOKIE_INSECURE is refused
        // without it, and the cookie must survive plain http on localhost.
        REJOX_INVITE_CODES: INVITE_CODE,
        REJOX_SESSION_SECRET: 'e2e-session-secret-not-a-real-one',
        REJOX_COOKIE_INSECURE: '1',
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
        // Empty = same origin, through the Vite proxy. A cross-origin value
        // here means the browser never sends the SameSite=Lax session cookie,
        // and every signed-in test fails for a reason that looks like anything
        // but its cause. Set explicitly so a stale frontend/.env cannot
        // reintroduce it.
        VITE_API_URL: '',
      },
    },
  ],
})

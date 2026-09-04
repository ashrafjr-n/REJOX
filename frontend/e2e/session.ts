import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))

/**
 * The invite code the e2e backend is configured with. A test credential for a
 * server bound to 127.0.0.1 and thrown away when the run ends — it is here, in
 * the open, precisely because it must never look like a real one.
 *
 * playwright.config.ts passes it to the backend as REJOX_INVITE_CODES.
 */
export const INVITE_CODE = 'e2e-invite-code'

/**
 * Where the signed-in cookie is parked between the `setup` project and the
 * projects that depend on it. Under e2e/fixtures/, which is generated and
 * already gitignored — a session cookie is a credential, however short-lived.
 */
export const SESSION_STATE = path.join(dir, 'fixtures', 'session-state.json')

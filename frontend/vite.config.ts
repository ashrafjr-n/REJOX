import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The dev server proxies /api and /health to the backend so the browser talks
 * to ONE origin. That is not a convenience: the session cookie is SameSite=Lax,
 * which a cross-site request does not carry, and it is Lax rather than None
 * because None would require allow_credentials CORS and hand this surface a
 * CSRF problem it does not otherwise have. Production puts a reverse proxy in
 * the same shape — see docs/SECURITY.md.
 */
const BACKEND = process.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: BACKEND, changeOrigin: false },
      '/health': { target: BACKEND, changeOrigin: false },
    },
  },
})

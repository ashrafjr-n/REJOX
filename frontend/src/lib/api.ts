import axios from 'axios'

/**
 * Shared Axios client for talking to the Rejox backend.
 * Base URL is overridable via VITE_API_URL for different environments.
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000',
})

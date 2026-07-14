import axios from 'axios'

/** Axios client pointed at the JSONPlaceholder fake API. */
export const client = axios.create({
  baseURL: 'https://jsonplaceholder.typicode.com',
})

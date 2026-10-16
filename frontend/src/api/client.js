import axios from 'axios'

const TOKEN_KEY = 'scenario_generator_token'

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
  timeout: 60000,
})

client.interceptors.request.use((config) => {
  const token = tokenStore.get()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// AuthContext registers a handler so an expired/invalid token logs the user out everywhere.
let onUnauthorized = null
export const setUnauthorizedHandler = (handler) => {
  onUnauthorized = handler
}

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const isAuthCall = error.config?.url?.startsWith('/auth/login') || error.config?.url?.startsWith('/auth/register')
    if (error.response?.status === 401 && !isAuthCall && onUnauthorized) onUnauthorized()
    return Promise.reject(error)
  },
)

/** Turn any axios/FastAPI error into a message that can be shown to the user. */
export function getErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (axios.isCancel(error)) return ''
  if (!error?.response) {
    if (error?.code === 'ECONNABORTED') return 'The request timed out. Please try again.'
    const target = error?.config?.baseURL || client.defaults.baseURL
    return (
      `Cannot reach the server at ${target}. Check that the backend is running and that this page is opened ` +
      `from an address the backend allows (CORS_ORIGINS), e.g. http://localhost:5173.`
    )
  }
  const detail = error.response.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const field = (item.loc || []).filter((part) => part !== 'body' && part !== 'query').join('.')
        return field ? `${field}: ${item.msg}` : item.msg
      })
      .join(' · ')
  }
  return fallback
}

/** Map FastAPI 422 validation errors to `{ fieldName: message }` for inline form errors. */
export function getFieldErrors(error) {
  const detail = error?.response?.data?.detail
  if (!Array.isArray(detail)) return {}
  return detail.reduce((errors, item) => {
    const field = (item.loc || []).at(-1)
    if (typeof field === 'string' && !errors[field]) errors[field] = item.msg.replace(/^Value error, /, '')
    return errors
  }, {})
}

export default client

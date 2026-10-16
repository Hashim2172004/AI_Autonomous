import client from './client'

const data = (promise) => promise.then((response) => response.data)

// Drop empty filter values so they are not sent as `?status=`.
const clean = (params = {}) =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value != null))

export const authApi = {
  register: (payload) => data(client.post('/auth/register', payload)),
  login: (payload) => data(client.post('/auth/login', payload)),
  me: () => data(client.get('/auth/me')),
}

export const systemsApi = {
  list: (params, config) => data(client.get('/systems', { params: clean(params), ...config })),
  get: (id) => data(client.get(`/systems/${id}`)),
  create: (payload) => data(client.post('/systems', payload)),
  update: (id, payload) => data(client.patch(`/systems/${id}`, payload)),
  remove: (id) => data(client.delete(`/systems/${id}`)),
}

export const scenariosApi = {
  list: (params, config) => data(client.get('/scenarios', { params: clean(params), ...config })),
  get: (id, config) => data(client.get(`/scenarios/${id}`, config)),
  create: (payload) => data(client.post('/scenarios', payload)),
  generate: (payload) => data(client.post('/scenarios/generate', payload)),
  update: (id, payload) => data(client.patch(`/scenarios/${id}`, payload)),
  remove: (id) => data(client.delete(`/scenarios/${id}`)),
  simulate: (id, payload) => data(client.post(`/scenarios/${id}/simulate`, payload || null)),
  simulations: (id, config) => data(client.get(`/scenarios/${id}/simulations`, config)),
  predict: (id) => data(client.post(`/scenarios/${id}/predict`, null, { timeout: 120000 })),
  whatIfs: (id, config) => data(client.get(`/scenarios/${id}/what-if`, config)),
  createWhatIf: (id, payload) => data(client.post(`/scenarios/${id}/what-if`, payload, { timeout: 120000 })),
}

export const analysisApi = {
  assumptions: (config) => data(client.get('/simulation/assumptions', config)),
  mlModel: (config) => data(client.get('/ml/model', config)),
  trainModel: () => data(client.post('/ml/train', null, { timeout: 300000 })),
}

export const simulationsApi = {
  list: (params, config) => data(client.get('/simulations', { params: clean(params), ...config })),
  get: (id, config) => data(client.get(`/simulations/${id}`, config)),
}

export const generationApi = {
  config: () => data(client.get('/generation/config')),
  start: (payload) => data(client.post('/generation/runs', payload)),
  list: (params, config) => data(client.get('/generation/runs', { params: clean(params), ...config })),
  get: (id, config) => data(client.get(`/generation/runs/${id}`, config)),
  scenarios: (id, config) => data(client.get(`/generation/runs/${id}/scenarios`, config)),
}

export const knowledgeApi = {
  list: (config) => data(client.get('/knowledge/documents', config)),
  create: (payload) => data(client.post('/knowledge/documents', payload)),
  upload: (file, title) => {
    const form = new FormData()
    form.append('file', file)
    if (title) form.append('title', title)
    return data(client.post('/knowledge/documents/upload', form, { timeout: 300000 }))
  },
  get: (id) => data(client.get(`/knowledge/documents/${id}`)),
  remove: (id) => data(client.delete(`/knowledge/documents/${id}`)),
  search: (payload) => data(client.post('/knowledge/search', payload)),
}

export const dashboardApi = {
  summary: (config) => data(client.get('/dashboard/summary', config)),
}

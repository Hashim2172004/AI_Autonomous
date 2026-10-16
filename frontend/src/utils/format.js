export const CATEGORY_LABELS = {
  demand: 'Demand',
  supply_chain: 'Supply chain',
  operations: 'Operations',
  workforce: 'Workforce',
  financial: 'Financial',
  regulatory: 'Regulatory',
  technology: 'Technology',
  external: 'External',
  opportunity: 'Opportunity',
}

export const STATUS_LABELS = { draft: 'Draft', running: 'Running', completed: 'Completed', failed: 'Failed' }
export const RISK_LABELS = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }

export const RISK_COLORS = { low: '#10b981', medium: '#f59e0b', high: '#f97316', critical: '#dc2626' }

export const titleCase = (value) =>
  value ? String(value).replace(/_/g, ' ').replace(/^\w/, (char) => char.toUpperCase()) : '—'

export const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

export const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—'

export const formatScore = (value) => (value == null ? '—' : Number(value).toFixed(1))

export const formatSignedPct = (value, digits = 1) => {
  if (value == null) return '—'
  const number = Number(value)
  return `${number > 0 ? '+' : ''}${number.toFixed(digits)}%`
}

export const formatNumber = (value, digits = 1) =>
  value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })

export const formatMoney = (value, currency = 'index units') =>
  value == null ? '—' : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency}`

export const formatPct = (value, digits = 0) => (value == null ? '—' : `${(Number(value) * 100).toFixed(digits)}%`)

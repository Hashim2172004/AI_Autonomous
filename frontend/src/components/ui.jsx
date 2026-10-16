import { AlertCircle, Inbox, Loader2 } from 'lucide-react'
import { RISK_LABELS, STATUS_LABELS, titleCase } from '../utils/format'

export function Spinner({ className = 'h-5 w-5' }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden="true" />
}

export function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-500" role="status">
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function ErrorAlert({ message, onRetry, className = '' }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 ${className}`}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="flex-1">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2 hover:text-red-900">
          Retry
        </button>
      )}
    </div>
  )
}

export function EmptyState({ title, description, action, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

const BADGE_BASE = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap'

const RISK_STYLES = {
  low: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  medium: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  high: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  critical: 'bg-red-50 text-red-700 ring-red-600/20',
}

const STATUS_STYLES = {
  draft: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  running: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  failed: 'bg-red-50 text-red-700 ring-red-600/20',
}

export function RiskBadge({ level }) {
  if (!level) return <span className="text-xs text-slate-400">Not assessed</span>
  return <span className={`${BADGE_BASE} ${RISK_STYLES[level] || STATUS_STYLES.draft}`}>{RISK_LABELS[level] || titleCase(level)}</span>
}

export function StatusBadge({ status }) {
  return (
    <span className={`${BADGE_BASE} ${STATUS_STYLES[status] || STATUS_STYLES.draft}`}>
      {STATUS_LABELS[status] || titleCase(status)}
    </span>
  )
}

const SEVERITY_STYLES = {
  low: RISK_STYLES.low,
  mild: RISK_STYLES.low,
  moderate: RISK_STYLES.medium,
  high: RISK_STYLES.high,
  severe: RISK_STYLES.high,
  critical: RISK_STYLES.critical,
}

export function SeverityBadge({ severity }) {
  if (!severity) return null
  return <span className={`${BADGE_BASE} ${SEVERITY_STYLES[severity] || STATUS_STYLES.draft}`}>{titleCase(severity)}</span>
}

/** Horizontal 0-1 gauge with the value printed next to it. */
export function Meter({ value, label, tone = 'bg-indigo-500' }) {
  if (value == null) return <span className="text-xs text-slate-400">—</span>
  const pct = Math.max(0, Math.min(1, Number(value))) * 100
  return (
    <div className="flex items-center gap-2" title={label}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 text-xs text-slate-700 tabular-nums">{pct.toFixed(0)}%</span>
    </div>
  )
}

export function Tag({ children }) {
  return <span className={`${BADGE_BASE} bg-indigo-50 text-indigo-700 ring-indigo-600/20`}>{children}</span>
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Delete', busy, onConfirm, onCancel }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <div className="card w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

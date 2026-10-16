import { FileText } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatDateTime } from '../utils/format'
import { Tag } from './ui'

const PRIORITY_STYLE = { high: 'text-red-700', medium: 'text-amber-700', low: 'text-slate-600' }

/** Renders a run report: LLM-written prose around deterministic figures, or the template fallback. */
export default function ReportCard({ report, systemName, createdAt, runId }) {
  if (!report) return null
  const llm = report.source === 'llm'
  return (
    <section className="card p-5" aria-labelledby="report-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="report-title" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <FileText className="h-4 w-4 text-indigo-600" aria-hidden="true" />
            Report{systemName ? ` — ${systemName}` : ''}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {llm ? `Written by ${report.model} from the simulation figures` : 'Template summary of the simulation figures'}
            {createdAt && ` · ${formatDateTime(createdAt)}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Tag>{llm ? 'AI-written' : 'Template'}</Tag>
          {runId && (
            <Link to={`/generation/${runId}`} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
              Open run
            </Link>
          )}
        </div>
      </div>

      {!llm && report.fallback_reason && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          The LLM report was not produced because {report.fallback_reason}.
        </p>
      )}

      <p className="mt-4 text-sm leading-relaxed text-slate-800">{report.executive_summary}</p>

      {report.key_findings?.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium tracking-wide text-slate-500 uppercase">Key findings</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {report.key_findings.map((finding, index) => (
              <li key={index}>{finding}</li>
            ))}
          </ul>
        </div>
      )}

      {report.top_risks?.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium tracking-wide text-slate-500 uppercase">Top risks</h3>
          <ul className="mt-1.5 space-y-1.5 text-sm text-slate-700">
            {report.top_risks.map((risk) => (
              <li key={risk.scenario_id}>
                <span className="mr-2 font-mono text-xs text-slate-400">{risk.scenario_id}</span>
                <span className="font-medium text-slate-900">{risk.title}</span> — {risk.why_it_matters}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.recommended_actions?.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium tracking-wide text-slate-500 uppercase">Recommended actions</h3>
          <ul className="mt-1.5 space-y-2 text-sm text-slate-700">
            {report.recommended_actions.map((action, index) => (
              <li key={index}>
                <span className={`mr-2 text-xs font-semibold uppercase ${PRIORITY_STYLE[action.priority] || ''}`}>
                  {action.priority}
                </span>
                {action.action}
                {action.rationale && <span className="text-slate-500"> — {action.rationale}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.open_questions?.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium tracking-wide text-slate-500 uppercase">Open questions</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {report.open_questions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ul>
        </div>
      )}

      {report.caveats?.length > 0 && (
        <details className="mt-4 text-xs text-slate-500">
          <summary className="cursor-pointer font-medium text-slate-600">Limitations of this report</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {report.caveats.map((caveat, index) => (
              <li key={index}>{caveat}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

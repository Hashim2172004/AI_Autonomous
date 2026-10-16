import { Activity, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { simulationsApi } from '../api'
import { EmptyState, ErrorAlert, LoadingState, PageHeader, RiskBadge, StatusBadge } from '../components/ui'
import { useFetch } from '../hooks/useFetch'
import { formatDateTime, formatScore, formatSignedPct } from '../utils/format'

const PAGE_SIZE = 15

export default function SimulationResults() {
  const [searchParams] = useSearchParams()
  const scenarioId = searchParams.get('scenario_id') || ''
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  const { data, loading, error, reload } = useFetch(
    ({ signal }) => simulationsApi.list({ scenario_id: scenarioId, status, page, page_size: PAGE_SIZE }, { signal }),
    [scenarioId, status, page],
  )

  return (
    <>
      <PageHeader
        title="Simulation results"
        description={
          scenarioId
            ? 'Runs for the selected scenario.'
            : 'Every simulation run across your scenarios. Open one to see its charts and risk analysis.'
        }
        actions={
          <>
            {scenarioId && (
              <Link to="/simulations" className="btn btn-secondary">
                Show all scenarios
              </Link>
            )}
            <select
              className="input w-auto"
              aria-label="Filter by status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value)
                setPage(1)
              }}
            >
              <option value="">Status: all</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="running">Running</option>
            </select>
          </>
        }
      />

      <div className="card overflow-hidden">
        {loading && !data ? (
          <LoadingState label="Loading simulation results…" />
        ) : error && !data ? (
          <div className="p-4">
            <ErrorAlert message={error} onRetry={reload} />
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No simulation results"
            description="Run a simulation from a scenario's page, or enable simulation when generating scenarios."
            action={
              <Link to="/scenarios" className="btn btn-primary">
                Go to scenarios
              </Link>
            }
          />
        ) : (
          <>
            {error && (
              <div className="p-4 pb-0">
                <ErrorAlert message={error} onRetry={reload} />
              </div>
            )}
            <div className={`overflow-x-auto transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-5 py-3">Run</th>
                    <th className="px-5 py-3">Scenario</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Risk</th>
                    <th className="px-5 py-3 text-right">Impact</th>
                    <th className="px-5 py-3 text-right">Profit change</th>
                    <th className="px-5 py-3 text-right">Runs</th>
                    <th className="px-5 py-3">Completed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((result) => (
                    <tr key={result.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 whitespace-nowrap">
                        <Link to={`/simulations/${result.id}`} className="font-medium text-indigo-600 hover:text-indigo-700">
                          #{result.id}
                        </Link>
                      </td>
                      <td className="max-w-sm px-5 py-3">
                        <Link
                          to={`/scenarios/${result.scenario_id}`}
                          className="block truncate text-slate-900 hover:text-indigo-600"
                          title={result.scenario_title}
                        >
                          {result.scenario_title}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={result.status} />
                      </td>
                      <td className="px-5 py-3">
                        <RiskBadge level={result.risk_analysis?.risk_level} />
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatScore(result.impact_score)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {formatSignedPct(result.metrics?.profit_change_pct)}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-600 tabular-nums">{result.iterations || '—'}</td>
                      <td className="px-5 py-3 whitespace-nowrap text-slate-500">
                        {formatDateTime(result.completed_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-sm text-slate-600">
              <p>
                {data.total} result{data.total === 1 ? '' : 's'}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-secondary px-2.5"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage(page - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <span className="tabular-nums">
                  Page {page} of {data.pages}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary px-2.5"
                  disabled={page >= data.pages || loading}
                  onClick={() => setPage(page + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}

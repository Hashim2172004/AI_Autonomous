import { Bot, PlusCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { generationApi } from '../api'
import { EmptyState, ErrorAlert, LoadingState, PageHeader, StatusBadge } from '../components/ui'
import { useFetch } from '../hooks/useFetch'
import { formatDateTime } from '../utils/format'

export default function GenerationRuns() {
  const { data, loading, error, reload } = useFetch(({ signal }) => generationApi.list({ page_size: 50 }, { signal }))

  return (
    <>
      <PageHeader
        title="AI generation runs"
        description="Every execution of the autonomous scenario-generation agent."
        actions={
          <Link to="/scenarios/new" className="btn btn-primary">
            <PlusCircle className="h-4 w-4" aria-hidden="true" />
            New run
          </Link>
        }
      />
      <div className="card overflow-hidden">
        {loading && !data ? (
          <LoadingState label="Loading runs…" />
        ) : error && !data ? (
          <div className="p-4"><ErrorAlert message={error} onRetry={reload} /></div>
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No AI runs yet"
            description="Choose “AI agent” on the Create Scenario page to start one."
            action={<Link to="/scenarios/new" className="btn btn-primary">Create scenario</Link>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-5 py-3">Started</th>
                  <th className="px-5 py-3">System</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Model</th>
                  <th className="px-5 py-3 text-right">Requested</th>
                  <th className="px-5 py-3 text-right">Saved</th>
                  <th className="px-5 py-3 text-right">Repaired</th>
                  <th className="px-5 py-3 text-right">Combos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 whitespace-nowrap">
                      <Link to={`/generation/${run.id}`} className="font-medium text-indigo-600 hover:text-indigo-700">
                        {formatDateTime(run.created_at)}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-700">{run.system_name}</td>
                    <td className="px-5 py-3"><StatusBadge status={run.status === 'queued' ? 'draft' : run.status} /></td>
                    <td className="px-5 py-3 text-xs text-slate-500">{run.options.llm_provider}/{run.options.llm_model}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{run.requested_count}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{run.stats?.saved ?? '—'}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{run.stats?.repaired ?? '—'}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{run.stats?.expanded ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

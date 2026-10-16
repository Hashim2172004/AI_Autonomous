import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, PlusCircle, Search, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { scenariosApi, systemsApi } from '../api'
import { getErrorMessage } from '../api/client'
import {
  ConfirmDialog,
  EmptyState,
  ErrorAlert,
  LoadingState,
  PageHeader,
  RiskBadge,
  Spinner,
  StatusBadge,
} from '../components/ui'
import { useDebounce, useFetch } from '../hooks/useFetch'
import { CATEGORY_LABELS, formatDate, formatScore, RISK_LABELS, STATUS_LABELS } from '../utils/format'

const PAGE_SIZE = 10

const SORT_OPTIONS = [
  { value: 'created_at', label: 'Date created' },
  { value: 'title', label: 'Title' },
  { value: 'impact_score', label: 'Impact score' },
  { value: 'risk_score', label: 'Risk score' },
  { value: 'status', label: 'Status' },
  { value: 'system_name', label: 'System' },
]

const DEFAULTS = { q: '', status: '', risk_level: '', category: '', system_id: '', sort_by: 'created_at', sort_order: 'desc', page: '1' }

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select className="input" value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        <option value="">{label}: all</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionValue === value ? `${label}: ${optionLabel}` : optionLabel}
          </option>
        ))}
      </select>
    </label>
  )
}

export default function Scenarios() {
  // Filters live in the URL so a filtered view can be bookmarked and survives back/forward.
  const [searchParams, setSearchParams] = useSearchParams()
  const params = Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, searchParams.get(key) ?? DEFAULTS[key]]))
  const page = Math.max(1, Number(params.page) || 1)

  const [searchText, setSearchText] = useState(params.q)
  const debouncedSearch = useDebounce(searchText)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState('')

  const updateParams = (changes) => {
    const next = { ...params, page: '1', ...changes }
    setSearchParams(
      Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== '' && String(value) !== DEFAULTS[key])),
      { replace: true },
    )
  }

  useEffect(() => {
    if (debouncedSearch !== params.q) updateParams({ q: debouncedSearch })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  const systems = useFetch(({ signal }) => systemsApi.list({}, { signal }))
  const { data, loading, error, reload } = useFetch(
    ({ signal }) => scenariosApi.list({ ...params, page, page_size: PAGE_SIZE }, { signal }),
    [searchParams.toString()],
  )

  const hasFilters = ['q', 'status', 'risk_level', 'category', 'system_id'].some((key) => params[key])
  const clearFilters = () => {
    setSearchText('')
    setSearchParams({}, { replace: true })
  }

  const confirmDelete = async () => {
    setDeleting(true)
    setActionError('')
    try {
      await scenariosApi.remove(pendingDelete.id)
      setPendingDelete(null)
      // Step back if the last row of the last page was removed.
      if (data.items.length === 1 && page > 1) updateParams({ page: String(page - 1) })
      else reload()
    } catch (deleteError) {
      setActionError(getErrorMessage(deleteError))
      setPendingDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const SortIcon = params.sort_order === 'asc' ? ArrowUp : ArrowDown
  const total = data?.total ?? 0
  const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const lastRow = Math.min(page * PAGE_SIZE, total)

  return (
    <>
      <PageHeader
        title="Scenarios"
        description="Search, filter and sort every what-if scenario in your workspace."
        actions={
          <Link to="/scenarios/new" className="btn btn-primary">
            <PlusCircle className="h-4 w-4" aria-hidden="true" />
            Create scenario
          </Link>
        }
      />

      <div className="card mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              className="input pl-9"
              placeholder="Search title, description or system…"
              aria-label="Search scenarios"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
          </div>
          <FilterSelect
            label="Status"
            value={params.status}
            onChange={(value) => updateParams({ status: value })}
            options={Object.entries(STATUS_LABELS)}
          />
          <FilterSelect
            label="Risk"
            value={params.risk_level}
            onChange={(value) => updateParams({ risk_level: value })}
            options={Object.entries(RISK_LABELS)}
          />
          <FilterSelect
            label="Category"
            value={params.category}
            onChange={(value) => updateParams({ category: value })}
            options={Object.entries(CATEGORY_LABELS)}
          />
          <FilterSelect
            label="System"
            value={params.system_id}
            onChange={(value) => updateParams({ system_id: value })}
            options={(systems.data || []).map((system) => [String(system.id), system.name])}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="sort_by" className="text-sm text-slate-500">
              Sort by
            </label>
            <select
              id="sort_by"
              className="input w-auto"
              value={params.sort_by}
              onChange={(event) => updateParams({ sort_by: event.target.value })}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary px-2.5"
              onClick={() => updateParams({ sort_order: params.sort_order === 'asc' ? 'desc' : 'asc' })}
              aria-label={`Sort ${params.sort_order === 'asc' ? 'ascending' : 'descending'}; click to reverse`}
              title={params.sort_order === 'asc' ? 'Ascending' : 'Descending'}
            >
              <SortIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {hasFilters && (
            <button type="button" className="btn btn-secondary" onClick={clearFilters}>
              <X className="h-4 w-4" aria-hidden="true" />
              Clear filters
            </button>
          )}
        </div>
      </div>

      <ErrorAlert message={actionError} className="mb-4" />

      <div className="card overflow-hidden">
        {loading && !data ? (
          <LoadingState label="Loading scenarios…" />
        ) : error && !data ? (
          <div className="p-4">
            <ErrorAlert message={error} onRetry={reload} />
          </div>
        ) : data.items.length === 0 ? (
          hasFilters ? (
            <EmptyState
              title="No scenarios match these filters"
              description="Try a different search term or clear the filters."
              action={
                <button type="button" className="btn btn-secondary" onClick={clearFilters}>
                  Clear filters
                </button>
              }
            />
          ) : (
            <EmptyState
              title="No scenarios yet"
              description="Describe a system to generate your first what-if scenarios."
              action={
                <Link to="/scenarios/new" className="btn btn-primary">
                  Create scenario
                </Link>
              }
            />
          )
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
                    <th className="px-5 py-3">Scenario</th>
                    <th className="px-5 py-3">System</th>
                    <th className="px-5 py-3">Category</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Risk</th>
                    <th className="px-5 py-3 text-right">Impact</th>
                    <th className="px-5 py-3">Created</th>
                    <th className="px-5 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((scenario) => (
                    <tr key={scenario.id} className="hover:bg-slate-50">
                      <td className="max-w-sm px-5 py-3">
                        <Link
                          to={`/scenarios/${scenario.id}`}
                          className="block truncate font-medium text-slate-900 hover:text-indigo-600"
                          title={scenario.title}
                        >
                          {scenario.title}
                        </Link>
                        <p className="truncate text-xs text-slate-500">{scenario.description}</p>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-slate-600">
                        {scenario.system_name}
                        <span className="block text-xs text-slate-400">{scenario.industry}</span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-slate-600">
                        {CATEGORY_LABELS[scenario.category] || scenario.category}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={scenario.status} />
                      </td>
                      <td className="px-5 py-3">
                        <RiskBadge level={scenario.risk_level} />
                      </td>
                      <td className="px-5 py-3 text-right text-slate-700 tabular-nums">
                        {formatScore(scenario.impact_score)}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-slate-500">{formatDate(scenario.created_at)}</td>
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          onClick={() => setPendingDelete(scenario)}
                          aria-label={`Delete ${scenario.title}`}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-sm text-slate-600">
              <p className="flex items-center gap-2">
                Showing {firstRow}–{lastRow} of {total}
                {loading && <Spinner className="h-4 w-4 text-slate-400" />}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-secondary px-2.5"
                  disabled={page <= 1 || loading}
                  onClick={() => updateParams({ page: String(page - 1) })}
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
                  onClick={() => updateParams({ page: String(page + 1) })}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete scenario?"
        message={`"${pendingDelete?.title}" and its simulation results will be permanently deleted.`}
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  )
}

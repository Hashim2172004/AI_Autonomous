import { ArrowDown, ArrowUp, Minus, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { analysisApi, scenariosApi } from '../api'
import { getErrorMessage } from '../api/client'
import { useFetch } from '../hooks/useFetch'
import { formatDateTime, formatMoney, formatNumber, titleCase } from '../utils/format'
import Plot from './Plot'
import { ErrorAlert, RiskBadge, Spinner } from './ui'

// Mirrors ScenarioParameters in the backend.
const PARAMETER_FIELDS = [
  { key: 'demand_change_pct', label: 'Demand change', unit: '%', min: -100, max: 300, step: 1 },
  { key: 'capacity_change_pct', label: 'Capacity change', unit: '%', min: -100, max: 300, step: 1 },
  { key: 'cost_change_pct', label: 'Unit cost change', unit: '%', min: -100, max: 300, step: 1 },
  { key: 'duration_days', label: 'Duration', unit: 'days', min: 1, max: 90, step: 1 },
  { key: 'recovery_days', label: 'Recovery', unit: 'days', min: 0, max: 60, step: 1 },
  { key: 'probability', label: 'Probability', unit: '', min: 0, max: 1, step: 0.01 },
  { key: 'volatility', label: 'Uncertainty', unit: '', min: 0, max: 1, step: 0.01 },
]
const SKIPPED_ASSUMPTIONS = new Set(['currency'])

const VERDICT_STYLE = {
  better: 'text-emerald-700',
  worse: 'text-red-700',
  unchanged: 'text-slate-500',
  changed: 'text-slate-700',
}

function formatValue(row, value) {
  if (value == null) return '—'
  if (row.unit === 'money') return formatNumber(value, 0)
  return `${formatNumber(value, Math.abs(value) < 10 ? 2 : 1)}${row.unit === '%' ? '%' : row.unit === 'days' ? ' d' : ''}`
}

function ComparisonView({ whatIf }) {
  const { comparison } = whatIf
  const series = comparison.series
  const output = useMemo(
    () => ({
      data: [
        { x: series.days, y: series.baseline_output, mode: 'lines', name: 'Baseline (no scenario)', line: { color: '#94a3b8', dash: 'dot', width: 2 } },
        { x: series.days, y: series.original_output, mode: 'lines', name: 'Original scenario', line: { color: '#4f46e5', width: 2.5 } },
        { x: series.days, y: series.updated_output, mode: 'lines', name: 'What-if', line: { color: '#f97316', width: 2.5 } },
      ],
      layout: {
        legend: { orientation: 'h', y: 1.18, x: 0 },
        margin: { l: 52, r: 16, t: 28, b: 44 },
        xaxis: { title: { text: 'Day' } },
        yaxis: { title: { text: 'Mean output (units/day)' }, rangemode: 'tozero' },
        hovermode: 'x unified',
      },
    }),
    [series],
  )
  const profit = useMemo(
    () => ({
      data: [
        { x: series.days, y: series.original_cumulative_profit, mode: 'lines', name: 'Original', line: { color: '#4f46e5', width: 2.5 } },
        { x: series.days, y: series.updated_cumulative_profit, mode: 'lines', name: 'What-if', line: { color: '#f97316', width: 2.5 } },
      ],
      layout: {
        legend: { orientation: 'h', y: 1.18, x: 0 },
        margin: { l: 60, r: 16, t: 28, b: 44 },
        xaxis: { title: { text: 'Day' } },
        yaxis: { title: { text: `Cumulative profit (${comparison.currency})` } },
        hovermode: 'x unified',
      },
    }),
    [series, comparison.currency],
  )

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium text-slate-900">{whatIf.name}</span>
        <span className="text-slate-500">risk:</span>
        <RiskBadge level={comparison.risk_level.original} />
        <span aria-hidden="true">→</span>
        <RiskBadge level={comparison.risk_level.updated} />
        <span className="text-xs text-slate-400">{formatDateTime(whatIf.created_at)}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="py-2 pr-4">Metric</th>
              <th className="px-4 py-2 text-right">Original</th>
              <th className="px-4 py-2 text-right">What-if</th>
              <th className="py-2 pl-4 text-right">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {comparison.metrics.map((row) => {
              const Icon = row.verdict === 'unchanged' ? Minus : row.delta > 0 ? ArrowUp : ArrowDown
              return (
                <tr key={row.key}>
                  <td className="py-2 pr-4 text-slate-700">
                    {row.label}
                    {row.unit === 'money' && <span className="ml-1 text-xs text-slate-400">({comparison.currency})</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatValue(row, row.original)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatValue(row, row.updated)}</td>
                  <td className={`py-2 pl-4 text-right font-medium tabular-nums ${VERDICT_STYLE[row.verdict]}`}>
                    <span className="inline-flex items-center gap-1">
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatNumber(Math.abs(row.delta), 2)}
                      {/* A relative change of a percentage (e.g. -3% -> -24% = -630%) misleads, so show points. */}
                      {row.unit === '%' && <span className="text-xs font-normal">pts</span>}
                      {row.unit !== '%' && row.delta_pct != null && row.verdict !== 'unchanged' && (
                        <span className="text-xs font-normal">({row.delta_pct > 0 ? '+' : ''}{row.delta_pct}%)</span>
                      )}
                      <span className="sr-only">{row.verdict}</span>
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        {comparison.common_random_numbers
          ? 'Both runs use the same random draws, so differences come from the changes you made, not from luck. '
          : ''}
        Green means an improvement for that metric, red a deterioration, grey a change that is not judged either way.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Plot {...output} height={280} ariaLabel="Output over time: original versus what-if" />
        <Plot {...profit} height={280} ariaLabel="Cumulative profit: original versus what-if" />
      </div>
    </div>
  )
}

export default function WhatIfPanel({ scenario }) {
  const history = useFetch(({ signal }) => scenariosApi.whatIfs(scenario.id, { signal }), [scenario.id, scenario.what_if_count])
  const assumptionInfo = useFetch(({ signal }) => analysisApi.assumptions({ signal }))
  const baseParameters = scenario.parameters
  const baseAssumptions = useMemo(
    () => scenario.latest_simulation?.assumptions || assumptionInfo.data?.defaults || {},
    [scenario.latest_simulation, assumptionInfo.data],
  )

  const [params, setParams] = useState(baseParameters)
  const [assumptions, setAssumptions] = useState({})
  const [name, setName] = useState('')
  const [showAssumptions, setShowAssumptions] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [current, setCurrent] = useState(null)

  useEffect(() => setParams(baseParameters), [baseParameters])
  useEffect(() => {
    if (!current && history.data?.length) setCurrent(history.data[0])
  }, [history.data, current])

  const changedParameters = Object.fromEntries(
    PARAMETER_FIELDS.filter(({ key }) => Number(params[key]) !== Number(baseParameters[key])).map(({ key }) => [key, Number(params[key])]),
  )
  const changedAssumptions = Object.fromEntries(
    Object.entries(assumptions).filter(([key, value]) => value !== '' && String(value) !== String(baseAssumptions[key])),
  )
  const dirty = Object.keys(changedParameters).length + Object.keys(changedAssumptions).length > 0
  const hasBaseline = scenario.latest_simulation?.status === 'completed'

  const run = async () => {
    setRunning(true)
    setError('')
    try {
      const created = await scenariosApi.createWhatIf(scenario.id, {
        name: name.trim() || null,
        parameters: changedParameters,
        assumptions: Object.fromEntries(
          Object.entries(changedAssumptions).map(([key, value]) => [key, Number.isNaN(Number(value)) ? value : Number(value)]),
        ),
      })
      setCurrent(created)
      setName('')
      history.reload()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setRunning(false)
    }
  }

  const reset = () => {
    setParams(baseParameters)
    setAssumptions({})
  }

  const numericAssumptions = (assumptionInfo.data?.fields || []).filter((field) => !SKIPPED_ASSUMPTIONS.has(field.name))

  return (
    <section className="card p-5" aria-labelledby="whatif-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="whatif-title" className="text-sm font-semibold text-slate-900">What-if analysis</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Change variables and re-simulate; the scenario itself is not modified.
            {!hasBaseline && ' The original will be simulated first.'}
          </p>
        </div>
        {dirty && (
          <button type="button" className="btn btn-secondary" onClick={reset}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Reset
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {PARAMETER_FIELDS.map((field) => {
          const changed = Number(params[field.key]) !== Number(baseParameters[field.key])
          return (
            <div key={field.key}>
              <div className="flex items-baseline justify-between">
                <label htmlFor={`whatif-${field.key}`} className="text-sm font-medium text-slate-700">
                  {field.label}
                </label>
                <span className="text-xs text-slate-500 tabular-nums">
                  {changed && <span className="mr-1 text-slate-400 line-through">{baseParameters[field.key]}</span>}
                  <span className={changed ? 'font-semibold text-orange-600' : ''}>
                    {params[field.key]}{field.unit === '%' ? '%' : ''}{field.unit === 'days' ? ' days' : ''}
                  </span>
                </span>
              </div>
              <input
                id={`whatif-${field.key}`}
                type="range"
                min={field.min}
                max={field.max}
                step={field.step}
                value={params[field.key] ?? 0}
                onChange={(event) => setParams((previous) => ({ ...previous, [field.key]: Number(event.target.value) }))}
                className="mt-1 w-full accent-indigo-600"
              />
            </div>
          )
        })}
      </div>

      <div className="mt-4">
        <button type="button" className="text-sm font-medium text-indigo-600 hover:text-indigo-700" onClick={() => setShowAssumptions((v) => !v)}>
          {showAssumptions ? 'Hide' : 'Edit'} simulation assumptions
          {Object.keys(changedAssumptions).length > 0 && ` (${Object.keys(changedAssumptions).length} changed)`}
        </button>
        {showAssumptions && (
          <div className="mt-3">
            <p className="mb-3 text-xs text-slate-500">{assumptionInfo.data?.note}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {numericAssumptions.map((field) => (
                <div key={field.name}>
                  <label htmlFor={`assume-${field.name}`} className="block text-xs font-medium text-slate-600" title={field.description}>
                    {titleCase(field.name)}
                  </label>
                  <input
                    id={`assume-${field.name}`}
                    type="number"
                    className="input mt-1"
                    step="any"
                    min={field.minimum ?? undefined}
                    max={field.maximum ?? undefined}
                    value={assumptions[field.name] ?? baseAssumptions[field.name] ?? ''}
                    onChange={(event) => setAssumptions((previous) => ({ ...previous, [field.name]: event.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <input
          className="input max-w-xs"
          placeholder="Name this what-if (optional)"
          aria-label="What-if name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={200}
        />
        <button type="button" className="btn btn-primary" onClick={run} disabled={!dirty || running}>
          {running && <Spinner className="h-4 w-4" />}
          {running ? 'Simulating…' : 'Run what-if'}
        </button>
        {!dirty && <span className="text-xs text-slate-500">Move a slider or edit an assumption first.</span>}
      </div>
      <ErrorAlert message={error} className="mt-4" />

      {history.data?.length > 1 && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Previous:</span>
          {history.data.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCurrent(item)}
              className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${
                current?.id === item.id ? 'bg-indigo-50 text-indigo-700 ring-indigo-600/30' : 'text-slate-600 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}

      {current && <ComparisonView whatIf={current} />}
      {!current && history.data && history.data.length === 0 && (
        <p className="mt-5 text-sm text-slate-500">No what-if analyses yet for this scenario.</p>
      )}
    </section>
  )
}

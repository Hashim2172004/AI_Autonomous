import { ArrowLeft, Pencil, Play, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { scenariosApi } from '../api'
import { getErrorMessage, getFieldErrors } from '../api/client'
import PredictionCard from '../components/PredictionCard'
import { OutcomeTable, OutputTimeseriesChart, SimulationMetrics } from '../components/SimulationCharts'
import WhatIfPanel from '../components/WhatIfPanel'
import {
  ConfirmDialog,
  EmptyState,
  ErrorAlert,
  LoadingState,
  PageHeader,
  Meter,
  RiskBadge,
  SeverityBadge,
  Spinner,
  StatusBadge,
  Tag,
} from '../components/ui'
import { useFetch } from '../hooks/useFetch'
import { CATEGORY_LABELS, formatDateTime, formatPct, formatScore, formatSignedPct, titleCase } from '../utils/format'

const PARAMETER_FIELDS = [
  { key: 'demand_change_pct', label: 'Demand change (%)', min: -100, max: 300, step: 0.1 },
  { key: 'capacity_change_pct', label: 'Capacity change (%)', min: -100, max: 300, step: 0.1 },
  { key: 'cost_change_pct', label: 'Unit cost change (%)', min: -100, max: 300, step: 0.1 },
  { key: 'duration_days', label: 'Duration (days)', min: 1, max: 90, step: 1 },
  { key: 'recovery_days', label: 'Recovery (days)', min: 0, max: 60, step: 1 },
  { key: 'probability', label: 'Likelihood (0–1)', min: 0, max: 1, step: 0.01 },
  { key: 'volatility', label: 'Uncertainty (0–1)', min: 0, max: 1, step: 0.01 },
]

function Section({ title, children, actions }) {
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {actions}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Definition({ label, children }) {
  if (!children) return null
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm whitespace-pre-line text-slate-700">{children}</dd>
    </div>
  )
}

function EditDialog({ scenario, onClose, onSaved }) {
  const [values, setValues] = useState({
    title: scenario.title,
    description: scenario.description,
    category: scenario.category,
    ...Object.fromEntries(PARAMETER_FIELDS.map(({ key }) => [key, scenario.parameters[key] ?? 0])),
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleChange = (event) => {
    const { name, value } = event.target
    setValues((previous) => ({ ...previous, [name]: value }))
    setErrors((previous) => ({ ...previous, [name]: undefined }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const validation = {}
    if (values.title.trim().length < 3) validation.title = 'Enter a title (at least 3 characters)'
    if (values.description.trim().length < 10) validation.description = 'Enter at least 10 characters'
    for (const field of PARAMETER_FIELDS) {
      const number = Number(values[field.key])
      if (values[field.key] === '' || Number.isNaN(number) || number < field.min || number > field.max) {
        validation[field.key] = `Between ${field.min} and ${field.max}`
      } else if (field.step === 1 && !Number.isInteger(number)) {
        validation[field.key] = 'Whole number'
      }
    }
    setErrors(validation)
    setFormError('')
    if (Object.keys(validation).length) return

    setSaving(true)
    try {
      const updated = await scenariosApi.update(scenario.id, {
        title: values.title.trim(),
        description: values.description.trim(),
        category: values.category,
        parameters: Object.fromEntries(PARAMETER_FIELDS.map(({ key }) => [key, Number(values[key])])),
      })
      onSaved(updated)
    } catch (error) {
      const fieldErrors = getFieldErrors(error)
      setErrors(fieldErrors)
      setFormError(Object.keys(fieldErrors).length ? 'Please correct the highlighted fields.' : getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const fieldClass = (name) => `input ${errors[name] ? 'border-red-400' : ''}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <form onSubmit={handleSubmit} noValidate className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6">
        <h2 className="text-lg font-semibold text-slate-900">Edit scenario</h2>
        <p className="mt-1 text-sm text-slate-500">Changed parameters take effect the next time you run a simulation.</p>
        <div className="mt-5 space-y-4">
          <ErrorAlert message={formError} />
          <div>
            <label htmlFor="title" className="label">Title</label>
            <input id="title" name="title" className={fieldClass('title')} value={values.title} onChange={handleChange} maxLength={300} />
            {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title}</p>}
          </div>
          <div>
            <label htmlFor="description" className="label">Description</label>
            <textarea id="description" name="description" rows={4} className={fieldClass('description')} value={values.description} onChange={handleChange} maxLength={5000} />
            {errors.description && <p className="mt-1 text-xs text-red-600">{errors.description}</p>}
          </div>
          <div>
            <label htmlFor="category" className="label">Category</label>
            <select id="category" name="category" className="input" value={values.category} onChange={handleChange}>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {PARAMETER_FIELDS.map((field) => (
              <div key={field.key}>
                <label htmlFor={field.key} className="label">{field.label}</label>
                <input
                  id={field.key}
                  name={field.key}
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  className={fieldClass(field.key)}
                  value={values[field.key]}
                  onChange={handleChange}
                />
                {errors[field.key] && <p className="mt-1 text-xs text-red-600">{errors[field.key]}</p>}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving && <Spinner className="h-4 w-4" />}
            Save changes
          </button>
        </div>
      </form>
    </div>
  )
}

export default function ScenarioDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: scenario, loading, error, reload, setData } = useFetch(
    ({ signal }) => scenariosApi.get(id, { signal }),
    [id],
  )
  const [simulating, setSimulating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState('')

  const backLink = (
    <Link to="/scenarios" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Scenarios
    </Link>
  )

  if (loading && !scenario) return <LoadingState label="Loading scenario…" />
  if (error && !scenario) {
    return (
      <>
        {backLink}
        <ErrorAlert message={error} onRetry={reload} />
      </>
    )
  }

  const runSimulation = async () => {
    setSimulating(true)
    setActionError('')
    try {
      await scenariosApi.simulate(scenario.id)
    } catch (simulationError) {
      setActionError(getErrorMessage(simulationError))
    } finally {
      setSimulating(false)
      reload()
    }
  }

  const deleteScenario = async () => {
    setDeleting(true)
    try {
      await scenariosApi.remove(scenario.id)
      navigate('/scenarios', { replace: true })
    } catch (deleteError) {
      setActionError(getErrorMessage(deleteError))
      setConfirmingDelete(false)
      setDeleting(false)
    }
  }

  const { parameters, system, latest_simulation: latest } = scenario
  const latestCompleted = latest?.status === 'completed' ? latest : null

  return (
    <>
      {backLink}
      <PageHeader
        title={scenario.title}
        description={`${system.name} · ${system.industry} · created ${formatDateTime(scenario.created_at)}`}
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Edit
            </button>
            <button type="button" className="btn btn-secondary text-red-600" onClick={() => setConfirmingDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete
            </button>
            <button type="button" className="btn btn-primary" onClick={runSimulation} disabled={simulating}>
              {simulating ? <Spinner className="h-4 w-4" /> : <Play className="h-4 w-4" aria-hidden="true" />}
              {simulating ? 'Simulating…' : latest ? 'Re-run simulation' : 'Run simulation'}
            </button>
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatusBadge status={scenario.status} />
        <RiskBadge level={scenario.risk_level} />
        <Tag>{CATEGORY_LABELS[scenario.category] || scenario.category}</Tag>
        <Tag>{titleCase(scenario.severity)} severity</Tag>
        <span className="text-xs text-slate-500">
          Source: {scenario.source === 'manual' ? 'created manually' : scenario.source === 'ai_agent' ? 'AI agent' : `${scenario.source} generator`}
        </span>
        {scenario.run_id && (
          <Link to={`/generation/${scenario.run_id}`} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
            View generation run
          </Link>
        )}
      </div>

      {scenario.rank != null && (
        <div className="card mb-6 grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Priority rank</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">#{scenario.rank}</p>
            <p className="text-xs text-slate-500">score {formatScore(scenario.rank_score)} / 100</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Probability (12 months)</p>
            <div className="mt-2"><Meter value={parameters.probability} tone="bg-sky-500" /></div>
          </div>
          <div>
            <p className="text-xs text-slate-500">Confidence</p>
            <div className="mt-2"><Meter value={scenario.confidence} tone="bg-emerald-500" /></div>
          </div>
          <div>
            <p className="text-xs text-slate-500">Cost / operational impact (1–5)</p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {scenario.details?.potential_cost ?? '—'} / {scenario.details?.operational_impact ?? '—'}
            </p>
          </div>
        </div>
      )}

      <ErrorAlert message={actionError || error} className="mb-4" />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="What if…">
            <p className="text-sm leading-relaxed text-slate-700">{scenario.description}</p>
          </Section>

          <Section title="Modelled shock">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ['Demand', formatSignedPct(parameters.demand_change_pct, 0)],
                ['Capacity', formatSignedPct(parameters.capacity_change_pct, 0)],
                ['Unit cost', formatSignedPct(parameters.cost_change_pct, 0)],
                ['Likelihood', formatPct(parameters.probability)],
                ['Duration', `${parameters.duration_days} days`],
                ['Recovery', `${parameters.recovery_days} days`],
                ['Uncertainty', formatPct(parameters.volatility)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="mt-0.5 text-base font-semibold text-slate-900 tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </Section>

          {scenario.details?.trigger_events?.length > 0 && (
            <Section title="Scenario definition">
              <div className="grid gap-5 sm:grid-cols-2">
                {[
                  ['Trigger events', scenario.details.trigger_events],
                  ['Initial conditions', scenario.details.initial_conditions],
                  ['Expected consequences', scenario.details.expected_consequences],
                  ['Required resources', scenario.details.required_resources],
                ].map(([label, items]) => (
                  <div key={label}>
                    <h3 className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</h3>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-slate-700">
                      {(items || []).map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              {scenario.details.changed_variables?.length > 0 && (
                <div className="mt-5 overflow-x-auto">
                  <h3 className="text-xs font-medium tracking-wide text-slate-500 uppercase">Changed variables</h3>
                  <table className="mt-1.5 min-w-full text-sm">
                    <thead className="text-left text-xs text-slate-500">
                      <tr>
                        <th className="py-1 pr-4 font-medium">Variable</th>
                        <th className="py-1 pr-4 font-medium">Baseline</th>
                        <th className="py-1 pr-4 font-medium">In scenario</th>
                        <th className="py-1 text-right font-medium">Change</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {scenario.details.changed_variables.map((variable, index) => (
                        <tr key={index}>
                          <td className="py-1.5 pr-4 text-slate-800">{variable.name}</td>
                          <td className="py-1.5 pr-4 text-slate-600">{variable.baseline}</td>
                          <td className="py-1.5 pr-4 text-slate-600">{variable.scenario_value}</td>
                          <td className="py-1.5 text-right tabular-nums text-slate-700">
                            {variable.change_pct == null ? '—' : formatSignedPct(variable.change_pct, 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {scenario.details.combination_rationale && (
                <p className="mt-5 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
                  <span className="font-medium">Why these events combine: </span>
                  {scenario.details.combination_rationale}
                </p>
              )}
            </Section>
          )}

          {scenario.related?.length > 0 && (
            <Section title="Related scenarios">
              <ul className="divide-y divide-slate-100">
                {scenario.related.map((item) => (
                  <li key={`${item.relation}-${item.scenario_id}`} className="flex flex-wrap items-center gap-3 py-2.5">
                    <Tag>{item.relation === 'component' ? 'Component of this' : 'Part of'}</Tag>
                    <Link to={`/scenarios/${item.scenario_id}`} className="min-w-0 flex-1 text-sm font-medium text-slate-900 hover:text-indigo-600">
                      {item.scenario_key && <span className="mr-2 text-xs font-normal text-slate-400">{item.scenario_key}</span>}
                      {item.title}
                    </Link>
                    <SeverityBadge severity={item.severity} />
                    {item.probability != null && <span className="text-xs text-slate-500">p={formatPct(item.probability)}</span>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {scenario.assumptions.length > 0 && (
            <Section title="Assumptions">
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
                {scenario.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <aside className="lg:col-span-1">
          <Section title="System">
            <dl className="space-y-4">
              <Definition label="Name">{system.name}</Definition>
              <Definition label="Industry / domain">{system.industry}</Definition>
              <Definition label="Description">{system.description}</Definition>
              <Definition label="Objective">{system.objective}</Definition>
              <Definition label="Current conditions">{system.current_conditions}</Definition>
              <Definition label="Available resources">{system.available_resources}</Definition>
              <Definition label="Constraints">{system.constraints}</Definition>
              {Object.keys(system.assumptions || {}).length > 0 && (
                <Definition label="Simulation assumptions (system overrides)">
                  {Object.entries(system.assumptions)
                    .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`)
                    .join('\n')}
                </Definition>
              )}
            </dl>
          </Section>
        </aside>
      </div>

      <div className="mt-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Latest simulation</h2>
          {scenario.simulation_count > 0 && (
            <div className="flex items-center gap-4 text-sm">
              {latestCompleted && (
                <Link to={`/simulations/${latestCompleted.id}`} className="font-medium text-indigo-600 hover:text-indigo-700">
                  Full results and risk analysis
                </Link>
              )}
              <Link to={`/simulations?scenario_id=${scenario.id}`} className="font-medium text-indigo-600 hover:text-indigo-700">
                All {scenario.simulation_count} run{scenario.simulation_count === 1 ? '' : 's'}
              </Link>
            </div>
          )}
        </div>

        {simulating ? (
          <div className="card">
            <LoadingState label="Running simulation…" />
          </div>
        ) : !latest ? (
          <div className="card">
            <EmptyState
              icon={Play}
              title="Not simulated yet"
              description="Run a simulation to estimate this scenario's impact and risk."
              action={
                <button type="button" className="btn btn-primary" onClick={runSimulation}>
                  Run simulation
                </button>
              }
            />
          </div>
        ) : !latestCompleted ? (
          <ErrorAlert
            message={
              latest.status === 'failed'
                ? `The last simulation failed${latest.error ? `: ${latest.error}` : '.'}`
                : 'The last simulation did not finish. Run it again.'
            }
          />
        ) : (
          <>
            <p className="card p-5 text-sm leading-relaxed text-slate-700">
              {latestCompleted.summary}
              {latestCompleted.risk_analysis && (
                <span className="mt-2 block text-slate-600">{latestCompleted.risk_analysis.summary}</span>
              )}
            </p>
            <SimulationMetrics result={latestCompleted} />
            <section className="card p-5">
              <h3 className="text-sm font-semibold text-slate-900">Worst, average and best case</h3>
              <div className="mt-3">
                <OutcomeTable metrics={latestCompleted.metrics} />
              </div>
            </section>
            <section className="card p-5">
              <h3 className="text-sm font-semibold text-slate-900">Output over time</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Mean daily output with the 10th–90th percentile range · {latestCompleted.iterations} runs ·{' '}
                {formatDateTime(latestCompleted.completed_at)}
              </p>
              <div className="mt-3">
                <OutputTimeseriesChart timeseries={latestCompleted.timeseries} />
              </div>
            </section>
          </>
        )}

        <PredictionCard scenario={scenario} onChanged={reload} />
        <WhatIfPanel scenario={scenario} />
      </div>

      {editing && (
        <EditDialog
          scenario={scenario}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setData(updated)
            setEditing(false)
          }}
        />
      )}
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete scenario?"
        message={`"${scenario.title}" and its simulation results will be permanently deleted.`}
        busy={deleting}
        onConfirm={deleteScenario}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  )
}

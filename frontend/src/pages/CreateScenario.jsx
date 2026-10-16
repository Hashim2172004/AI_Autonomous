import { CheckCircle2, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { analysisApi, generationApi, scenariosApi, systemsApi } from '../api'
import { getErrorMessage, getFieldErrors } from '../api/client'
import { ErrorAlert, PageHeader, RiskBadge, Spinner, StatusBadge, Tag } from '../components/ui'
import { useFetch } from '../hooks/useFetch'
import { CATEGORY_LABELS, formatScore } from '../utils/format'

const EMPTY_FORM = {
  system_id: '',
  name: '',
  industry: '',
  description: '',
  objective: '',
  current_conditions: '',
  available_resources: '',
  constraints: '',
  num_scenarios: 5,
  auto_simulate: true,
  expand: true,
  use_knowledge: true,
}

/** Only the assumptions the user filled in, with numbers converted; empty values are dropped. */
function cleanedAssumptions(overrides) {
  return Object.fromEntries(
    Object.entries(overrides || {})
      .filter(([, value]) => value !== '' && value != null)
      .map(([key, value]) => [key, key === 'currency' ? String(value) : Number(value)]),
  )
}

const INDUSTRY_SUGGESTIONS = [
  'Manufacturing',
  'Logistics & Supply Chain',
  'Energy & Utilities',
  'Healthcare',
  'Retail & E-commerce',
  'Financial Services',
  'Information Technology',
  'Agriculture & Food',
  'Construction',
  'Transportation',
]

// Mirrors the backend limits in app/schemas/system.py so most errors are caught before submitting.
function validate(values) {
  const errors = {}
  const length = (field) => values[field].trim().length
  if (length('name') < 2) errors.name = 'Enter a system name (at least 2 characters)'
  if (length('industry') < 2) errors.industry = 'Enter the industry or domain'
  if (length('description') < 10) errors.description = 'Describe the system in at least 10 characters'
  if (length('objective') < 5) errors.objective = 'State the objective (at least 5 characters)'
  const count = Number(values.num_scenarios)
  if (!Number.isInteger(count) || count < 1 || count > 20) errors.num_scenarios = 'Choose between 1 and 20 scenarios'
  return errors
}

function FormField({ id, label, hint, error, required, children }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>
      )}
    </div>
  )
}

function GenerationResult({ result, onReset }) {
  return (
    <>
      <PageHeader title="Scenarios generated" description={`For ${result.system.name} · ${result.system.industry}`} />
      <div className="mb-5 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          {result.scenarios.length} scenario{result.scenarios.length === 1 ? '' : 's'} saved
          {result.simulated > 0 && ` and ${result.simulated} simulated`}.
          {result.simulation_failures > 0 && ` ${result.simulation_failures} simulation(s) failed and can be re-run.`}
        </p>
      </div>

      <ul className="space-y-3">
        {result.scenarios.map((scenario) => (
          <li key={scenario.id} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Link to={`/scenarios/${scenario.id}`} className="font-semibold text-slate-900 hover:text-indigo-600">
                  {scenario.title}
                </Link>
                <p className="mt-1 line-clamp-2 text-sm text-slate-600">{scenario.description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Tag>{CATEGORY_LABELS[scenario.category] || scenario.category}</Tag>
                <StatusBadge status={scenario.status} />
                <RiskBadge level={scenario.risk_level} />
                {scenario.impact_score != null && (
                  <span className="text-xs text-slate-500">Impact {formatScore(scenario.impact_score)}</span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link to={`/scenarios?system_id=${result.system.id}`} className="btn btn-primary">
          View in scenarios
        </Link>
        <button type="button" className="btn btn-secondary" onClick={onReset}>
          Generate more
        </button>
      </div>
    </>
  )
}

export default function CreateScenario() {
  const [values, setValues] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const systems = useFetch(({ signal }) => systemsApi.list({}, { signal }), [result])
  const aiConfig = useFetch(({ signal }) => generationApi.config({ signal }))
  const assumptionInfo = useFetch(({ signal }) => analysisApi.assumptions({ signal }))
  const [assumptionOverrides, setAssumptionOverrides] = useState({})
  const [showAssumptions, setShowAssumptions] = useState(false)
  const navigate = useNavigate()
  // null = follow availability: AI agent when an LLM is configured, rule-based otherwise.
  const [chosenMode, setChosenMode] = useState(null)
  const mode = chosenMode || (aiConfig.data?.llm_configured ? 'ai' : 'rules')

  const setField = (name, value) => {
    setValues((previous) => ({ ...previous, [name]: value }))
    setErrors((previous) => ({ ...previous, [name]: undefined }))
  }
  const handleChange = (event) => {
    const { name, value, type, checked } = event.target
    setField(name, type === 'checkbox' ? checked : value)
  }

  const handleSystemSelect = (event) => {
    const id = event.target.value
    const system = systems.data?.find((item) => String(item.id) === id)
    setErrors({})
    setAssumptionOverrides(system?.assumptions || {})
    setValues((previous) =>
      system
        ? {
            ...previous,
            system_id: id,
            name: system.name,
            industry: system.industry,
            description: system.description,
            objective: system.objective,
            current_conditions: system.current_conditions,
            available_resources: system.available_resources,
            constraints: system.constraints,
          }
        : { ...EMPTY_FORM, num_scenarios: previous.num_scenarios, auto_simulate: previous.auto_simulate },
    )
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const validation = validate(values)
    setErrors(validation)
    setFormError('')
    if (Object.keys(validation).length) {
      document.getElementById(Object.keys(validation)[0])?.focus()
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        ...values,
        system_id: values.system_id ? Number(values.system_id) : null,
        num_scenarios: Number(values.num_scenarios),
        assumptions: cleanedAssumptions(assumptionOverrides),
      }
      if (mode === 'ai') {
        // Returns immediately; the run page polls the agent's progress.
        const run = await generationApi.start(payload)
        navigate(`/generation/${run.id}`)
        return
      }
      const response = await scenariosApi.generate(payload)
      setResult(response)
      window.scrollTo({ top: 0 })
    } catch (error) {
      const fieldErrors = getFieldErrors(error)
      setErrors(fieldErrors)
      setFormError(Object.keys(fieldErrors).length ? 'Please correct the highlighted fields.' : getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <GenerationResult
        result={result}
        onReset={() => {
          setResult(null)
          setValues((previous) => ({ ...previous, system_id: String(result.system.id) }))
        }}
      />
    )
  }

  const inputProps = (name) => ({
    id: name,
    name,
    value: values[name],
    onChange: handleChange,
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
    className: `input ${errors[name] ? 'border-red-400' : ''}`,
  })

  return (
    <>
      <PageHeader
        title="Create scenario"
        description="Describe the system. The generator uses these details to produce realistic what-if scenarios."
      />

      <form onSubmit={handleSubmit} noValidate className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <ErrorAlert message={formError} />

          <section className="card space-y-5 p-6">
            <h2 className="text-sm font-semibold text-slate-900">System</h2>

            {systems.data?.length > 0 && (
              <FormField
                id="system_id"
                label="Start from"
                hint="Pick an existing system to add scenarios to it; edits below update that system."
              >
                <select id="system_id" className="input" value={values.system_id} onChange={handleSystemSelect}>
                  <option value="">A new system</option>
                  {systems.data.map((system) => (
                    <option key={system.id} value={system.id}>
                      {system.name} — {system.industry} ({system.scenario_count} scenarios)
                    </option>
                  ))}
                </select>
              </FormField>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField id="name" label="System name" required error={errors.name}>
                <input {...inputProps('name')} maxLength={200} placeholder="e.g. Bottling Plant North" />
              </FormField>
              <FormField id="industry" label="Industry / domain" required error={errors.industry}>
                <input {...inputProps('industry')} maxLength={120} list="industry-options" placeholder="e.g. Manufacturing" />
                <datalist id="industry-options">
                  {INDUSTRY_SUGGESTIONS.map((industry) => (
                    <option key={industry} value={industry} />
                  ))}
                </datalist>
              </FormField>
            </div>

            <FormField
              id="description"
              label="System description"
              required
              error={errors.description}
              hint="What the system does, its main components and how work flows through it."
            >
              <textarea {...inputProps('description')} rows={4} maxLength={5000} />
            </FormField>

            <FormField
              id="objective"
              label="Objective"
              required
              error={errors.objective}
              hint="What the system should achieve, e.g. service level, output or cost targets."
            >
              <textarea {...inputProps('objective')} rows={2} maxLength={2000} />
            </FormField>
          </section>

          <section className="card space-y-5 p-6">
            <h2 className="text-sm font-semibold text-slate-900">Operating context</h2>
            <FormField
              id="current_conditions"
              label="Current conditions"
              error={errors.current_conditions}
              hint="How the system is running today: utilisation, backlog, known issues."
            >
              <textarea {...inputProps('current_conditions')} rows={3} maxLength={5000} />
            </FormField>
            <FormField
              id="available_resources"
              label="Available resources"
              error={errors.available_resources}
              hint="People, equipment, budget, inventory. Separate items with commas or new lines."
            >
              <textarea {...inputProps('available_resources')} rows={3} maxLength={5000} />
            </FormField>
            <FormField
              id="constraints"
              label="Constraints"
              error={errors.constraints}
              hint="Limits that cannot be broken. Separate items with commas or new lines."
            >
              <textarea {...inputProps('constraints')} rows={3} maxLength={5000} />
            </FormField>
          </section>

          <section className="card p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Simulation assumptions (optional)</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Saved with the system and used for all of its simulations. Leave blank to use the defaults. Values are
                  in index units (baseline demand = 100) unless you set a unit value and currency.
                </p>
              </div>
              <button
                type="button"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                onClick={() => setShowAssumptions((value) => !value)}
                aria-expanded={showAssumptions}
              >
                {showAssumptions ? 'Hide' : 'Edit'}
                {Object.keys(cleanedAssumptions(assumptionOverrides)).length > 0 &&
                  ` (${Object.keys(cleanedAssumptions(assumptionOverrides)).length} set)`}
              </button>
            </div>
            {showAssumptions && (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {(assumptionInfo.data?.fields || []).map((field) => (
                  <div key={field.name}>
                    <label htmlFor={`assumption-${field.name}`} className="block text-xs font-medium text-slate-600" title={field.description}>
                      {field.name.replace(/_/g, ' ')}
                    </label>
                    <input
                      id={`assumption-${field.name}`}
                      className="input mt-1"
                      type={field.name === 'currency' ? 'text' : 'number'}
                      step="any"
                      min={field.name === 'currency' ? undefined : (field.minimum ?? undefined)}
                      max={field.name === 'currency' ? undefined : (field.maximum ?? undefined)}
                      placeholder={String(field.default)}
                      value={assumptionOverrides[field.name] ?? ''}
                      onChange={(event) =>
                        setAssumptionOverrides((previous) => ({ ...previous, [field.name]: event.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="lg:col-span-1">
          <section className="card space-y-5 p-6 lg:sticky lg:top-8">
            <h2 className="text-sm font-semibold text-slate-900">Generation</h2>

            <fieldset>
              <legend className="label">Method</legend>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['ai', 'AI agent'],
                  ['rules', 'Rule-based'],
                ].map(([value, label]) => (
                  <label
                    key={value}
                    className={`cursor-pointer rounded-lg border px-3 py-2 text-center text-sm font-medium ${
                      mode === value ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="method"
                      value={value}
                      checked={mode === value}
                      onChange={() => setChosenMode(value)}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
              {mode === 'ai' ? (
                <p className="mt-2 text-xs text-slate-500">
                  {aiConfig.data?.llm_configured ? (
                    <>
                      Runs the LangGraph agent with {aiConfig.data.llm_provider}/{aiConfig.data.llm_model}: analysis,
                      knowledge retrieval, generation, validation and repair, expansion into combinations, ranking.
                    </>
                  ) : (
                    <span className="text-amber-700">
                      {aiConfig.loading ? 'Checking the LLM configuration…' : aiConfig.data?.llm_hint || 'The LLM is not configured.'}
                    </span>
                  )}
                </p>
              ) : (
                <p className="mt-2 text-xs text-slate-500">Instant template-based scenarios; no LLM or knowledge base.</p>
              )}
            </fieldset>

            {mode === 'ai' && (
              <div className="space-y-3">
                <label className="flex items-start gap-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    name="expand"
                    checked={values.expand}
                    onChange={handleChange}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-indigo-600"
                  />
                  <span>
                    Expand into combinations
                    <span className="block text-xs text-slate-500">Adds compound scenarios, e.g. machine failure + worker shortage.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    name="use_knowledge"
                    checked={values.use_knowledge}
                    onChange={handleChange}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-indigo-600"
                  />
                  <span>
                    Use the knowledge base
                    <span className="block text-xs text-slate-500">
                      {aiConfig.data ? `${aiConfig.data.knowledge_documents} document(s). ` : ''}
                      <Link to="/knowledge" className="text-indigo-600 hover:text-indigo-700">Manage</Link>
                    </span>
                  </span>
                </label>
              </div>
            )}

            <FormField
              id="num_scenarios"
              label="Number of scenarios"
              required
              error={errors.num_scenarios}
              hint="Between 1 and 20."
            >
              <input {...inputProps('num_scenarios')} type="number" min={1} max={20} step={1} />
            </FormField>

            {mode === 'ai' ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                The agent simulates every scenario, predicts outcomes with the ML model, scores the risk and writes a
                report as part of the run.
              </p>
            ) : (
              <label className="flex items-start gap-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="auto_simulate"
                  checked={values.auto_simulate}
                  onChange={handleChange}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-indigo-600"
                />
                <span>
                  Simulate each scenario right away
                  <span className="block text-xs text-slate-500">Adds impact and risk scores to every scenario.</span>
                </span>
              </label>
            )}

            <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
              {submitting ? <Spinner className="h-4 w-4" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
              {submitting ? (mode === 'ai' ? 'Starting agent…' : 'Generating…') : mode === 'ai' ? 'Start AI generation' : 'Generate scenarios'}
            </button>
            <p className="text-xs text-slate-500">
              The system and every generated scenario are saved to your workspace.
            </p>
          </section>
        </aside>
      </form>
    </>
  )
}

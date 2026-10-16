import { ArrowLeft, Check, CircleDashed, Minus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { generationApi } from '../api'
import { getErrorMessage } from '../api/client'
import ReportCard from '../components/ReportCard'
import ScenarioGraph from '../components/ScenarioGraph'
import {
  EmptyState,
  ErrorAlert,
  LoadingState,
  Meter,
  PageHeader,
  RiskBadge,
  SeverityBadge,
  Spinner,
  StatusBadge,
  Tag,
} from '../components/ui'
import { CATEGORY_LABELS, formatDateTime, formatScore, titleCase } from '../utils/format'

const POLL_MS = 1500
const ACTIVE = new Set(['queued', 'running'])

function StepIcon({ status }) {
  const base = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full'
  if (status === 'running') return <span className={`${base} bg-indigo-100 text-indigo-600`}><Spinner className="h-4 w-4" /></span>
  if (status === 'completed') return <span className={`${base} bg-emerald-100 text-emerald-600`}><Check className="h-4 w-4" aria-hidden="true" /></span>
  if (status === 'failed') return <span className={`${base} bg-red-100 text-red-600`}><X className="h-4 w-4" aria-hidden="true" /></span>
  if (status === 'skipped') return <span className={`${base} bg-slate-100 text-slate-400`}><Minus className="h-4 w-4" aria-hidden="true" /></span>
  return <span className={`${base} bg-slate-100 text-slate-400`}><CircleDashed className="h-4 w-4" aria-hidden="true" /></span>
}

function WorkflowSteps({ steps, running }) {
  return (
    <ol className="space-y-1">
      {steps.map((step, index) => {
        const muted = step.status === 'pending' || step.status === 'skipped'
        return (
          <li key={step.node} className="relative flex gap-3 pb-3">
            {index < steps.length - 1 && <span className="absolute top-8 left-3.5 h-[calc(100%-1.5rem)] w-px bg-slate-200" aria-hidden="true" />}
            <StepIcon status={step.status} />
            <div className="min-w-0 flex-1 pt-0.5">
              <p className={`text-sm font-medium ${muted ? 'text-slate-400' : 'text-slate-900'}`}>
                {step.label}
                {step.runs > 1 && <span className="ml-2 text-xs font-normal text-slate-500">ran {step.runs}×</span>}
                {step.status === 'skipped' && <span className="ml-2 text-xs font-normal">not needed</span>}
              </p>
              {step.message ? (
                <p className="mt-0.5 text-xs text-slate-600">{step.message}</p>
              ) : (
                step.status === 'running' && running && <p className="mt-0.5 text-xs text-indigo-600">Working…</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function ActivityLog({ events }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [events.length])
  return (
    <div ref={ref} className="max-h-72 overflow-y-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-200" aria-live="polite">
      {events.map((event, index) => (
        <p key={index} className={event.status === 'failed' ? 'text-red-300' : event.status === 'completed' ? 'text-emerald-300' : ''}>
          <span className="text-slate-500">{new Date(event.at).toLocaleTimeString()} </span>
          {event.node && <span className="text-indigo-300">[{event.node}] </span>}
          {event.message}
        </p>
      ))}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-slate-900 tabular-nums">{value ?? 0}</p>
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function ResultsTable({ scenarios }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Scenario</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Probability</th>
              <th className="px-4 py-3">Confidence</th>
              <th className="px-4 py-3">Risk</th>
              <th className="px-4 py-3 text-right">Priority</th>
              <th className="px-4 py-3 text-right">Impact</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {scenarios.map((scenario) => (
              <tr key={scenario.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-500 tabular-nums">{scenario.rank}</td>
                <td className="max-w-md px-4 py-3">
                  <Link to={`/scenarios/${scenario.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                    {scenario.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-slate-400">{scenario.scenario_key}</span>
                    <Tag>{CATEGORY_LABELS[scenario.category] || titleCase(scenario.category)}</Tag>
                  </div>
                </td>
                <td className="px-4 py-3"><SeverityBadge severity={scenario.severity} /></td>
                <td className="px-4 py-3"><Meter value={scenario.parameters.probability} label="Probability within 12 months" tone="bg-sky-500" /></td>
                <td className="px-4 py-3"><Meter value={scenario.confidence} label="Confidence" tone="bg-emerald-500" /></td>
                <td className="px-4 py-3"><RiskBadge level={scenario.risk_level} /></td>
                <td className="px-4 py-3 text-right tabular-nums">{formatScore(scenario.rank_score)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatScore(scenario.impact_score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function GenerationRun() {
  const { id } = useParams()
  const [run, setRun] = useState(null)
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')
  const [pollError, setPollError] = useState('')
  const resultsLoadedFor = useRef(null)

  const loadResults = useCallback(async () => {
    try {
      setResults(await generationApi.scenarios(id))
    } catch (resultsError) {
      setError(getErrorMessage(resultsError))
    }
  }, [id])

  useEffect(() => {
    let cancelled = false
    let timer
    const poll = async () => {
      try {
        const latest = await generationApi.get(id)
        if (cancelled) return
        setRun(latest)
        setPollError('')
        if (ACTIVE.has(latest.status)) timer = setTimeout(poll, POLL_MS)
      } catch (requestError) {
        if (cancelled) return
        if (requestError.response?.status === 404) return setError(getErrorMessage(requestError))
        // Transient failure (server restarting, network blip): keep trying.
        setPollError(getErrorMessage(requestError))
        timer = setTimeout(poll, POLL_MS * 2)
      }
    }
    poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [id])

  useEffect(() => {
    if (run?.status === 'completed' && resultsLoadedFor.current !== id) {
      resultsLoadedFor.current = id
      loadResults()
    }
  }, [run?.status, id, loadResults])

  const back = (
    <Link to="/generation" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      AI runs
    </Link>
  )

  if (error && !run) return <>{back}<ErrorAlert message={error} /></>
  if (!run) return <LoadingState label="Loading run…" />

  const active = ACTIVE.has(run.status)
  const stats = run.stats || {}
  const issues = run.validation_report?.issues || []
  const dropped = run.validation_report?.dropped || []
  const analysis = run.system_analysis

  return (
    <>
      {back}
      <PageHeader
        title={active ? 'Generating scenarios…' : run.status === 'failed' ? 'Generation failed' : 'Generated scenarios'}
        description={`${run.system_name} · ${run.options.llm_provider}/${run.options.llm_model} · started ${formatDateTime(run.created_at)}`}
        actions={<StatusBadge status={run.status === 'queued' ? 'draft' : run.status} />}
      />

      <ErrorAlert message={error || pollError} className="mb-4" />
      {run.status === 'failed' && (
        <ErrorAlert
          className="mb-4"
          message={`The agent stopped before finishing: ${run.error || 'unknown error'}. Nothing was saved from this run.`}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Section title="Agent workflow" subtitle={active ? 'Updating live' : 'Final status of each step'}>
            <WorkflowSteps steps={run.steps} running={active} />
          </Section>
        </div>
        <div className="space-y-6 lg:col-span-2">
          <Section title="Activity">
            <ActivityLog events={run.events} />
          </Section>
          {run.status === 'completed' && (
            <Section title="Run summary">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Initial scenarios" value={stats.generated} />
                <Stat label="Repaired" value={stats.repaired} />
                <Stat label="Dropped" value={stats.dropped} />
                <Stat label="Combinations added" value={stats.expanded} />
                <Stat label="Saved" value={stats.saved} />
                <Stat label="Simulated" value={stats.simulations} />
                <Stat label="ML predictions" value={stats.predictions} />
                <Stat label="Risk reports" value={stats.risk_reports} />
                <Stat label="LLM requests" value={stats.limits ? `${stats.limits.llm_calls_used}/${stats.limits.llm_calls_limit}` : stats.llm_calls} />
                <Stat label="Tokens (in/out)" value={`${stats.input_tokens ?? 0}/${stats.output_tokens ?? 0}`} />
                <Stat label="Run time" value={stats.limits ? `${stats.limits.seconds_used}s` : '—'} />
              </div>
              {stats.limits_reached?.length > 0 && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
                  Execution limit reached, so some optional steps were skipped: {stats.limits_reached.join('; ')}.
                </p>
              )}
            </Section>
          )}
        </div>
      </div>

      {run.status === 'completed' && (
        <div className="mt-6 space-y-6">
          {!results ? (
            <LoadingState label="Loading scenarios…" />
          ) : results.scenarios.length === 0 ? (
            <div className="card"><EmptyState title="No scenarios were saved" description="Every generated scenario failed validation." /></div>
          ) : (
            <>
              <div>
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Scenarios, ranked by priority</h2>
                <ResultsTable scenarios={results.scenarios} />
              </div>
              <ReportCard report={run.report} systemName={run.system_name} createdAt={run.completed_at} />
              {results.relationships.length > 0 && (
                <Section
                  title="Scenario relationships"
                  subtitle="Combined scenarios link to the base events they are made of. Click a node to open it."
                >
                  <ScenarioGraph scenarios={results.scenarios} relationships={results.relationships} />
                </Section>
              )}
            </>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {analysis && (
              <Section title="How the agent understood the system">
                <p className="text-sm text-slate-700">{analysis.summary}</p>
                <dl className="mt-3 space-y-3 text-sm">
                  {[
                    ['Vulnerabilities', analysis.vulnerabilities],
                    ['Hard constraints', analysis.hard_constraints],
                    ['Information gaps (assumed)', analysis.missing_information],
                  ].map(([label, items]) =>
                    items?.length ? (
                      <div key={label}>
                        <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
                        <dd className="mt-1 text-slate-700">{items.join(' · ')}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>
              </Section>
            )}
            <Section
              title="Knowledge used"
              subtitle={run.options.use_knowledge ? 'Passages retrieved from the knowledge base' : 'Knowledge base was disabled for this run'}
            >
              {run.retrieved_knowledge.length ? (
                <ul className="space-y-3">
                  {run.retrieved_knowledge.map((chunk, index) => (
                    <li key={index} className="text-sm">
                      <p className="font-medium text-slate-800">
                        {chunk.title} <span className="text-xs font-normal text-slate-400">relevance {Math.round(chunk.score * 100)}%</span>
                      </p>
                      <p className="mt-0.5 line-clamp-3 text-xs text-slate-600">{chunk.text}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">
                  Nothing retrieved. <Link to="/knowledge" className="text-indigo-600 hover:text-indigo-700">Add documents</Link> to ground future runs.
                </p>
              )}
            </Section>
          </div>

          <Section
            title="Validation"
            subtitle={issues.length ? `${issues.length} problem(s) detected and handled automatically` : 'No problems were found'}
          >
            {issues.length === 0 ? (
              <p className="text-sm text-slate-600">All scenarios passed duplicate, range, consistency, constraint and completeness checks on the first pass.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {issues.map((issue, index) => (
                  <li key={index} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
                    <span className="w-16 font-mono text-xs text-slate-500">{issue.scenario_id}</span>
                    <Tag>{titleCase(issue.issue_type)}</Tag>
                    <span className="min-w-0 flex-1 text-slate-700">{issue.message}</span>
                    <span
                      className={`text-xs font-medium ${issue.outcome === 'repaired' ? 'text-emerald-600' : issue.outcome === 'dropped' ? 'text-red-600' : 'text-slate-400'}`}
                    >
                      {issue.outcome}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {dropped.length > 0 && (
              <p className="mt-3 text-xs text-red-600">
                Dropped after repair attempts: {dropped.map((item) => `${item.scenario_id} “${item.title}”`).join(', ')}
              </p>
            )}
          </Section>
        </div>
      )}
    </>
  )
}

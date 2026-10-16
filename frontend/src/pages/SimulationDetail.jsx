import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { simulationsApi } from '../api'
import {
  BacklogChart,
  CumulativeProfitChart,
  OutcomeTable,
  OutputTimeseriesChart,
  ProfitDistributionChart,
  RiskFactorsChart,
  SimulationMetrics,
  UtilizationChart,
} from '../components/SimulationCharts'
import { ErrorAlert, LoadingState, PageHeader, RiskBadge, StatusBadge } from '../components/ui'
import { useFetch } from '../hooks/useFetch'
import { formatDateTime, formatPct, formatScore } from '../utils/format'

function Section({ title, subtitle, children, className = '' }) {
  return (
    <section className={`card p-5 ${className}`}>
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

export default function SimulationDetail() {
  const { id } = useParams()
  const { data: result, loading, error, reload } = useFetch(({ signal }) => simulationsApi.get(id, { signal }), [id])

  if (loading && !result) return <LoadingState label="Loading simulation…" />
  if (error && !result) {
    return (
      <>
        <Link to="/simulations" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Simulation results
        </Link>
        <ErrorAlert message={error} onRetry={reload} />
      </>
    )
  }

  const risk = result.risk_analysis
  const completed = result.status === 'completed'

  return (
    <>
      <Link to="/simulations" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Simulation results
      </Link>
      <PageHeader
        title={`Simulation #${result.id}`}
        description={
          <>
            <Link to={`/scenarios/${result.scenario_id}`} className="font-medium text-indigo-600 hover:text-indigo-700">
              {result.scenario_title}
            </Link>
            {' · '}
            {result.iterations} runs · {result.engine.replace(/_/g, ' ')} · {formatDateTime(result.completed_at)}
          </>
        }
        actions={
          <>
            <StatusBadge status={result.status} />
            {risk && <RiskBadge level={risk.risk_level} />}
          </>
        }
      />

      {!completed ? (
        <ErrorAlert
          message={
            result.status === 'failed'
              ? `This simulation failed${result.error ? `: ${result.error}` : '.'} Re-run it from the scenario page.`
              : 'This simulation has not finished yet.'
          }
          onRetry={reload}
        />
      ) : (
        <div className="space-y-6">
          <p className="card p-5 text-sm leading-relaxed text-slate-700">{result.summary}</p>

          <SimulationMetrics result={result} />

          <Section
            title="Output over time"
            subtitle="Mean daily output with the 10th–90th percentile range across simulation runs"
          >
            <OutputTimeseriesChart timeseries={result.timeseries} />
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Worst, average and best case" subtitle="Outcomes across the simulated runs">
              <OutcomeTable metrics={result.metrics} />
            </Section>
            <Section title="Cumulative profit" subtitle="Average run versus the best and worst runs">
              <CumulativeProfitChart timeseries={result.timeseries} currency={result.metrics.currency} />
            </Section>
            <Section title="Delay" subtitle="Orders waiting in the backlog (days of normal-capacity work = backlog / baseline capacity)">
              <BacklogChart timeseries={result.timeseries} />
            </Section>
            <Section title="Resource utilisation" subtitle="Share of available capacity in use; dashed line = overtime threshold">
              <UtilizationChart
                timeseries={result.timeseries}
                threshold={result.assumptions?.overtime_threshold ?? 0.95}
              />
            </Section>
            <Section title="Outcome distribution" subtitle="Total profit change in each simulation run">
              <ProfitDistributionChart distribution={result.distribution} metrics={result.metrics} />
            </Section>
            <Section title="Assumptions used" subtitle="The simulation is only as realistic as these">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {Object.entries(result.assumptions || {}).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-2 border-b border-slate-100 py-1">
                    <dt className="text-slate-500">{key.replace(/_/g, ' ')}</dt>
                    <dd className="font-medium text-slate-800 tabular-nums">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          </div>

          {risk && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Section title="Risk analysis" subtitle={risk.summary}>
                <dl className="mb-2 grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
                  {[
                    ['Risk score', formatScore(risk.risk_score)],
                    ['Probability', formatPct(risk.probability)],
                    ['Impact', formatScore(risk.impact)],
                    ['Severity', formatScore(risk.severity)],
                    ['Financial', formatScore(risk.financial_impact)],
                    ['Operational', formatScore(risk.operational_impact)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-slate-50 px-3 py-2.5">
                      <dt className="text-xs text-slate-500">{label}</dt>
                      <dd className="mt-0.5 text-lg font-semibold text-slate-900 tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
                <RiskFactorsChart risk={risk} />
              </Section>
              <Section title="Recommended mitigations" subtitle="Rule-based suggestions for this scenario category">
                <ul className="space-y-3">
                  {risk.mitigations.map((mitigation) => (
                    <li key={mitigation} className="flex items-start gap-3 text-sm text-slate-700">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                      {mitigation}
                    </li>
                  ))}
                </ul>
              </Section>
            </div>
          )}
        </div>
      )}
    </>
  )
}

import { Activity, AlertTriangle, Gauge, Layers, PlusCircle } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { dashboardApi } from '../api'
import MlModelCard from '../components/MlModelCard'
import Plot from '../components/Plot'
import ReportCard from '../components/ReportCard'
import { EmptyState, ErrorAlert, LoadingState, PageHeader, RiskBadge, StatusBadge } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useFetch } from '../hooks/useFetch'
import {
  CATEGORY_LABELS,
  formatDate,
  formatMoney,
  formatNumber,
  formatScore,
  formatSignedPct,
  RISK_COLORS,
  RISK_LABELS,
  titleCase,
} from '../utils/format'

function StatCard({ label, value, hint, icon: Icon, tone }) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
        </div>
        <div className={`rounded-lg p-2.5 ${tone}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">{hint}</p>
    </div>
  )
}

function ChartCard({ title, subtitle, children }) {
  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

const truncate = (text, length = 56) => (text.length > length ? `${text.slice(0, length - 1)}…` : text)

export default function Dashboard() {
  const { user } = useAuth()
  const { data, loading, error, reload } = useFetch(({ signal }) => dashboardApi.summary({ signal }))

  const riskChart = useMemo(() => {
    const rows = data?.risk_distribution || []
    return {
      data: [
        {
          type: 'pie',
          hole: 0.62,
          labels: rows.map((row) => RISK_LABELS[row.label] || titleCase(row.label)),
          values: rows.map((row) => row.count),
          marker: { colors: rows.map((row) => RISK_COLORS[row.label] || '#94a3b8') },
          sort: false,
          textinfo: 'value',
          hovertemplate: '%{label}: %{value} scenarios (%{percent})<extra></extra>',
        },
      ],
      layout: { showlegend: true, legend: { orientation: 'h', y: -0.08 }, margin: { l: 8, r: 8, t: 8, b: 8 } },
    }
  }, [data])

  const categoryChart = useMemo(() => {
    const rows = [...(data?.category_distribution || [])].reverse()
    return {
      data: [
        {
          type: 'bar',
          orientation: 'h',
          y: rows.map((row) => CATEGORY_LABELS[row.label] || titleCase(row.label)),
          x: rows.map((row) => row.count),
          marker: { color: '#4f46e5' },
          hovertemplate: '%{y}: %{x}<extra></extra>',
        },
      ],
      layout: { margin: { l: 8, r: 16, t: 8, b: 48 }, xaxis: { dtick: 1, title: { text: 'Scenarios' } } },
    }
  }, [data])

  const impactChart = useMemo(() => {
    const rows = [...(data?.top_impact || [])].reverse()
    return {
      data: [
        {
          type: 'bar',
          orientation: 'h',
          y: rows.map((row) => `${truncate(row.title)} `),
          x: rows.map((row) => row.impact_score),
          marker: { color: rows.map((row) => RISK_COLORS[row.risk_level] || '#94a3b8') },
          customdata: rows.map((row) => [row.title, RISK_LABELS[row.risk_level] || 'Not assessed']),
          hovertemplate: '%{customdata[0]}<br>Impact %{x:.1f} · %{customdata[1]} risk<extra></extra>',
        },
      ],
      layout: { margin: { l: 8, r: 16, t: 8, b: 48 }, xaxis: { range: [0, 100], title: { text: 'Impact score (0–100)' } } },
    }
  }, [data])

  const matrixChart = useMemo(() => {
    const points = data?.risk_matrix || []
    const levels = ['critical', 'high', 'medium', 'low']
    return {
      data: levels
        .map((level) => {
          const group = points.filter((point) => point.risk_level === level)
          return {
            type: 'scatter',
            mode: 'markers',
            name: RISK_LABELS[level],
            x: group.map((point) => point.probability * 100),
            y: group.map((point) => point.impact),
            text: group.map((point) => point.title),
            customdata: group.map((point) => [point.risk_score]),
            marker: { color: RISK_COLORS[level], size: 13, line: { color: '#ffffff', width: 1.5 }, opacity: 0.9 },
            hovertemplate: '%{text}<br>Probability %{x:.0f}% · impact %{y:.0f}/100<br>Risk score %{customdata[0]:.0f}<extra></extra>',
          }
        })
        .filter((trace) => trace.x.length),
      layout: {
        legend: { orientation: 'h', y: -0.22 },
        margin: { l: 52, r: 16, t: 8, b: 70 },
        xaxis: { title: { text: 'Probability within 12 months (%)' }, range: [0, 100] },
        yaxis: { title: { text: 'Impact (0–100)' }, range: [0, 100] },
      },
    }
  }, [data])

  const comparisonChart = useMemo(() => {
    const rows = data?.comparison || []
    const names = rows.map((row) => truncate(row.title, 26))
    const bar = (name, key, color) => ({
      type: 'bar',
      name,
      x: names,
      y: rows.map((row) => row[key]),
      marker: { color },
      customdata: rows.map((row) => row.title),
      hovertemplate: '%{customdata}<br>' + name + ': %{y:.1f}%<extra></extra>',
    })
    return {
      data: [
        bar('Worst case', 'worst_case_profit_change_pct', '#dc2626'),
        bar('Average', 'profit_change_pct', '#4f46e5'),
        bar('Best case', 'best_case_profit_change_pct', '#10b981'),
      ],
      layout: {
        barmode: 'group',
        legend: { orientation: 'h', y: 1.02, yanchor: 'bottom', x: 0 },
        margin: { l: 52, r: 16, t: 48, b: 110 },
        xaxis: { tickangle: -30 },
        yaxis: { title: { text: 'Profit change (%)' }, ticksuffix: '%' },
      },
    }
  }, [data])

  if (loading && !data) return <LoadingState label="Loading dashboard…" />
  if (error && !data) return <ErrorAlert message={error} onRetry={reload} />

  const { totals } = data
  const hasScenarios = totals.total_scenarios > 0
  const hasResults = data.top_impact.length > 0
  const highRiskShare = hasScenarios ? Math.round((totals.high_risk_scenarios / totals.total_scenarios) * 100) : 0

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.full_name.split(' ')[0]}`}
        description="Overview of your scenarios, simulations and risk exposure."
        actions={
          <Link to="/scenarios/new" className="btn btn-primary">
            <PlusCircle className="h-4 w-4" aria-hidden="true" />
            Create scenario
          </Link>
        }
      />
      <ErrorAlert message={error} onRetry={reload} className="mb-4" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total scenarios"
          value={totals.total_scenarios}
          hint={`Across ${totals.total_systems} system${totals.total_systems === 1 ? '' : 's'}`}
          icon={Layers}
          tone="bg-indigo-50 text-indigo-600"
        />
        <StatCard
          label="High-risk scenarios"
          value={totals.high_risk_scenarios}
          hint={hasScenarios ? `${highRiskShare}% rated high or critical` : 'Rated high or critical'}
          icon={AlertTriangle}
          tone="bg-red-50 text-red-600"
        />
        <StatCard
          label="Completed simulations"
          value={totals.completed_simulations}
          hint="Simulation runs finished successfully"
          icon={Activity}
          tone="bg-emerald-50 text-emerald-600"
        />
        <StatCard
          label="Average impact"
          value={formatScore(totals.average_impact)}
          hint="Mean impact score (0–100) of simulated scenarios"
          icon={Gauge}
          tone="bg-amber-50 text-amber-600"
        />
      </div>

      {!hasScenarios ? (
        <div className="card mt-6">
          <EmptyState
            title="No scenarios yet"
            description="Describe a system and generate your first set of what-if scenarios to populate the dashboard."
            action={
              <Link to="/scenarios/new" className="btn btn-primary">
                Create scenario
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <ChartCard title="Risk distribution" subtitle="Scenarios by assessed risk level">
              {data.risk_distribution.length ? (
                <Plot {...riskChart} height={280} ariaLabel="Risk level distribution" />
              ) : (
                <EmptyState title="No risk assessments yet" description="Run a simulation to assess risk." />
              )}
            </ChartCard>
            <ChartCard title="Scenarios by category" subtitle="What kinds of what-ifs are covered">
              <Plot {...categoryChart} height={280} ariaLabel="Scenarios by category" />
            </ChartCard>
            <div className="md:col-span-2">
              <ChartCard title="Highest-impact scenarios" subtitle="Bar colour shows the risk level">
                {hasResults ? (
                  <Plot {...impactChart} height={300} ariaLabel="Highest-impact scenarios" />
                ) : (
                  <EmptyState title="No simulation results yet" description="Run a simulation to measure impact." />
                )}
              </ChartCard>
            </div>
          </div>

          {data.risk_matrix.length > 0 && (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <ChartCard title="Risk matrix" subtitle="Probability against impact; colour is the risk level">
                <Plot {...matrixChart} height={340} ariaLabel="Risk matrix: probability versus impact" />
              </ChartCard>
              <ChartCard title="Scenario comparison" subtitle="Profit change of the highest-risk scenarios: worst, average and best case">
                <Plot {...comparisonChart} height={340} ariaLabel="Profit change by scenario" />
              </ChartCard>
            </div>
          )}

          {data.comparison.length > 0 && (
            <section className="card mt-6 overflow-hidden">
              <h2 className="px-5 py-4 text-sm font-semibold text-slate-900">Highest-risk scenarios compared</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
                    <tr>
                      <th className="px-5 py-2.5">Scenario</th>
                      <th className="px-5 py-2.5">Risk</th>
                      <th className="px-5 py-2.5 text-right">Profit (avg)</th>
                      <th className="px-5 py-2.5 text-right">Cost change</th>
                      <th className="px-5 py-2.5 text-right">Delay (days)</th>
                      <th className="px-5 py-2.5 text-right">Unserved</th>
                      <th className="px-5 py-2.5 text-right">Peak util.</th>
                      <th className="px-5 py-2.5 text-right">Expected loss</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.comparison.map((row) => (
                      <tr key={row.scenario_id} className="hover:bg-slate-50">
                        <td className="max-w-xs px-5 py-2.5">
                          <Link to={`/scenarios/${row.scenario_id}`} className="block truncate font-medium text-slate-900 hover:text-indigo-600">
                            {row.title}
                          </Link>
                        </td>
                        <td className="px-5 py-2.5"><RiskBadge level={row.risk_level} /></td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{formatSignedPct(row.profit_change_pct)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{formatSignedPct(row.total_cost_change_pct)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{formatNumber(row.avg_delay_days, 2)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{formatNumber(row.unmet_demand_pct, 1)}%</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{formatNumber(row.peak_utilization_pct, 0)}%</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(row.expected_financial_loss, row.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {data.latest_report ? (
              <ReportCard
                report={data.latest_report.report}
                systemName={data.latest_report.system_name}
                createdAt={data.latest_report.created_at}
                runId={data.latest_report.run_id}
              />
            ) : (
              <section className="card p-5">
                <h2 className="text-sm font-semibold text-slate-900">Report</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Reports are written at the end of an AI agent run.{' '}
                  <Link to="/scenarios/new" className="text-indigo-600 hover:text-indigo-700">Start one</Link>
                </p>
              </section>
            )}
            <MlModelCard model={data.ml_model} onTrained={reload} />
          </div>

          <section className="card mt-6 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">Recent scenarios</h2>
              <Link to="/scenarios" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
                View all
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-5 py-2.5">Scenario</th>
                    <th className="px-5 py-2.5">System</th>
                    <th className="px-5 py-2.5">Status</th>
                    <th className="px-5 py-2.5">Risk</th>
                    <th className="px-5 py-2.5 text-right">Impact</th>
                    <th className="px-5 py-2.5">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.recent_scenarios.map((scenario) => (
                    <tr key={scenario.id} className="hover:bg-slate-50">
                      <td className="max-w-xs px-5 py-3">
                        <Link
                          to={`/scenarios/${scenario.id}`}
                          className="block truncate font-medium text-slate-900 hover:text-indigo-600"
                        >
                          {scenario.title}
                        </Link>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-slate-600">{scenario.system_name}</td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  )
}

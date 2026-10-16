import { useMemo } from 'react'
import { formatMoney, formatNumber, formatScore, formatSignedPct, RISK_COLORS } from '../utils/format'
import Plot from './Plot'
import { RiskBadge } from './ui'

function Metric({ label, value, hint }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export function SimulationMetrics({ result }) {
  const { metrics, risk_analysis: risk } = result
  const currency = metrics.currency
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Impact score" value={formatScore(result.impact_score)} hint="0–100, higher is a bigger swing" />
      <Metric
        label="Profit change"
        value={formatSignedPct(metrics.profit_change_pct)}
        hint={`Worst ${formatSignedPct(metrics.profit_change_p5)} · best ${formatSignedPct(metrics.profit_change_p95)}`}
      />
      <Metric
        label="Total cost change"
        value={formatSignedPct(metrics.cost?.change_pct)}
        hint={`Expected loss ${formatMoney(metrics.cost?.expected_financial_loss, currency)}`}
      />
      <Metric
        label="Order delay"
        value={`${formatNumber(metrics.delay?.avg_days, 2)} days`}
        hint={`Peak ${formatNumber(metrics.delay?.peak_days, 1)} · worst case ${formatNumber(metrics.delay?.worst_case_peak_days, 1)} days of work waiting`}
      />
      <Metric
        label="Service level"
        value={`${Number(metrics.service_level_pct).toFixed(1)}%`}
        hint={`${Number(metrics.unmet_demand_pct).toFixed(1)}% of demand unserved`}
      />
      <Metric
        label="Resource utilisation"
        value={`${formatNumber(metrics.resources?.avg_utilization_pct, 0)}% avg`}
        hint={`Peak ${formatNumber(metrics.resources?.peak_utilization_pct, 0)}% · ${formatNumber(metrics.resources?.overload_days, 0)} days at overtime`}
      />
      <Metric
        label="Capacity gap"
        value={`${formatNumber(metrics.resources?.capacity_gap_pct, 0)}%`}
        hint="Extra daily capacity that would have avoided unserved demand"
      />
      <Metric
        label="Risk score"
        value={risk ? formatScore(risk.risk_score) : '—'}
        hint={risk ? <RiskBadge level={risk.risk_level} /> : 'Not assessed'}
      />
    </div>
  )
}

const OUTCOME_ROWS = [
  ['profit_change_pct', 'Profit change', (v) => formatSignedPct(v)],
  ['cost_change_pct', 'Total cost change', (v) => formatSignedPct(v)],
  ['total_cost', 'Total cost', (v, c) => formatMoney(v, c)],
  ['avg_delay_days', 'Average delay (days)', (v) => formatNumber(v, 2)],
  ['peak_delay_days', 'Peak delay (days)', (v) => formatNumber(v, 1)],
  ['unmet_demand_pct', 'Unserved demand', (v) => `${formatNumber(v, 1)}%`],
  ['peak_utilization_pct', 'Peak utilisation', (v) => `${formatNumber(v, 0)}%`],
  ['overload_days', 'Days at overtime utilisation', (v) => formatNumber(v, 0)],
  ['capacity_gap_pct', 'Capacity gap', (v) => `${formatNumber(v, 0)}%`],
]

/** Worst / average / best case of the simulated runs (5th and 95th percentile outcomes). */
export function OutcomeTable({ metrics }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
          <tr>
            <th className="py-2 pr-4">Outcome</th>
            <th className="px-4 py-2 text-right">Worst case</th>
            <th className="px-4 py-2 text-right">Average</th>
            <th className="py-2 pl-4 text-right">Best case</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {OUTCOME_ROWS.map(([key, label, format]) => (
            <tr key={key}>
              <td className="py-2 pr-4 text-slate-700">{label}</td>
              <td className="px-4 py-2 text-right text-red-700 tabular-nums">{format(metrics.worst_case?.[key], metrics.currency)}</td>
              <td className="px-4 py-2 text-right text-slate-900 tabular-nums">{format(metrics.average?.[key], metrics.currency)}</td>
              <td className="py-2 pl-4 text-right text-emerald-700 tabular-nums">{format(metrics.best_case?.[key], metrics.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">
        Worst / best case are the 5th / 95th percentile outcomes across {metrics.horizon_days}-day simulation runs.
      </p>
    </div>
  )
}

export function OutputTimeseriesChart({ timeseries, height = 340 }) {
  const chart = useMemo(
    () => ({
      data: [
        { x: timeseries.days, y: timeseries.scenario_output_p90, mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
        {
          x: timeseries.days,
          y: timeseries.scenario_output_p10,
          mode: 'lines',
          line: { width: 0 },
          fill: 'tonexty',
          fillcolor: 'rgba(79,70,229,0.15)',
          name: 'Scenario 10–90% range',
          hoverinfo: 'skip',
        },
        {
          x: timeseries.days,
          y: timeseries.baseline_output,
          mode: 'lines',
          name: 'Baseline',
          line: { color: '#94a3b8', dash: 'dot', width: 2 },
          hovertemplate: 'Day %{x}: %{y:.1f}<extra>Baseline</extra>',
        },
        {
          x: timeseries.days,
          y: timeseries.scenario_output,
          mode: 'lines',
          name: 'Scenario (mean)',
          line: { color: '#4f46e5', width: 2.5 },
          hovertemplate: 'Day %{x}: %{y:.1f}<extra>Scenario</extra>',
        },
      ],
      layout: {
        legend: { orientation: 'h', y: 1.14, x: 0 },
        margin: { l: 52, r: 16, t: 28, b: 44 },
        xaxis: { title: { text: 'Day' } },
        yaxis: { title: { text: 'Output (units/day)' }, rangemode: 'tozero' },
        hovermode: 'x unified',
      },
    }),
    [timeseries],
  )
  return <Plot {...chart} height={height} ariaLabel="Daily output: baseline versus scenario" />
}

export function ProfitTimeseriesChart({ timeseries, height = 300 }) {
  const chart = useMemo(
    () => ({
      data: [
        { x: timeseries.days, y: timeseries.baseline_profit, mode: 'lines', name: 'Baseline', line: { color: '#94a3b8', dash: 'dot', width: 2 } },
        { x: timeseries.days, y: timeseries.scenario_profit, mode: 'lines', name: 'Scenario (mean)', line: { color: '#0ea5e9', width: 2.5 } },
      ],
      layout: {
        legend: { orientation: 'h', y: 1.16, x: 0 },
        margin: { l: 52, r: 16, t: 28, b: 44 },
        xaxis: { title: { text: 'Day' } },
        yaxis: { title: { text: 'Daily profit' } },
        hovermode: 'x unified',
      },
    }),
    [timeseries],
  )
  return <Plot {...chart} height={height} ariaLabel="Daily profit: baseline versus scenario" />
}

export function CumulativeProfitChart({ timeseries, currency, height = 300 }) {
  const chart = useMemo(
    () => ({
      data: [
        { x: timeseries.days, y: timeseries.best_case_cumulative_profit, mode: 'lines', name: 'Best case', line: { color: '#10b981', width: 2 } },
        { x: timeseries.days, y: timeseries.average_cumulative_profit, mode: 'lines', name: 'Average', line: { color: '#4f46e5', width: 2.5 } },
        { x: timeseries.days, y: timeseries.worst_case_cumulative_profit, mode: 'lines', name: 'Worst case', line: { color: '#dc2626', width: 2 } },
      ],
      layout: {
        legend: { orientation: 'h', y: 1.16, x: 0 },
        margin: { l: 60, r: 16, t: 28, b: 44 },
        xaxis: { title: { text: 'Day' } },
        yaxis: { title: { text: `Cumulative profit (${currency || 'index units'})` } },
        hovermode: 'x unified',
      },
    }),
    [timeseries, currency],
  )
  return <Plot {...chart} height={height} ariaLabel="Cumulative profit: best, average and worst case" />
}

export function BacklogChart({ timeseries, height = 300 }) {
  const chart = useMemo(
    () => ({
      data: [
        { x: timeseries.days, y: timeseries.scenario_backlog_p90, mode: 'lines', name: '90th percentile', line: { color: '#f97316', dash: 'dot', width: 1.5 } },
        { x: timeseries.days, y: timeseries.scenario_backlog, mode: 'lines', name: 'Average backlog', line: { color: '#f59e0b', width: 2.5 }, fill: 'tozeroy', fillcolor: 'rgba(245,158,11,0.15)' },
      ],
      layout: {
        legend: { orientation: 'h', y: 1.16, x: 0 },
        margin: { l: 52, r: 16, t: 28, b: 44 },
        xaxis: { title: { text: 'Day' } },
        yaxis: { title: { text: 'Backlog (units waiting)' }, rangemode: 'tozero' },
        hovermode: 'x unified',
      },
    }),
    [timeseries],
  )
  return <Plot {...chart} height={height} ariaLabel="Backlog of unserved orders over time" />
}

export function UtilizationChart({ timeseries, threshold = 0.95, height = 300 }) {
  const chart = useMemo(
    () => ({
      data: [
        { x: timeseries.days, y: timeseries.baseline_utilization_pct, mode: 'lines', name: 'Baseline', line: { color: '#94a3b8', dash: 'dot', width: 2 } },
        { x: timeseries.days, y: timeseries.scenario_utilization_pct, mode: 'lines', name: 'Scenario', line: { color: '#8b5cf6', width: 2.5 } },
      ],
      layout: {
        legend: { orientation: 'h', y: 1.16, x: 0 },
        margin: { l: 52, r: 16, t: 28, b: 44 },
        xaxis: { title: { text: 'Day' } },
        yaxis: { title: { text: 'Utilisation (%)' }, range: [0, 105] },
        shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: threshold * 100, y1: threshold * 100, line: { color: '#dc2626', width: 1, dash: 'dash' } }],
        hovermode: 'x unified',
      },
    }),
    [timeseries, threshold],
  )
  return <Plot {...chart} height={height} ariaLabel="Resource utilisation over time" />
}

export function ProfitDistributionChart({ distribution, metrics, height = 300 }) {
  const chart = useMemo(
    () => ({
      data: [
        {
          type: 'histogram',
          x: distribution,
          nbinsx: 30,
          marker: { color: '#4f46e5', line: { color: '#ffffff', width: 1 } },
          hovertemplate: '%{x}%: %{y} runs<extra></extra>',
        },
      ],
      layout: {
        bargap: 0.04,
        xaxis: { title: { text: 'Profit change over the horizon (%)' }, ticksuffix: '%' },
        yaxis: { title: { text: 'Simulation runs' } },
        shapes: [
          { type: 'line', x0: metrics.profit_change_p50, x1: metrics.profit_change_p50, yref: 'paper', y0: 0, y1: 1, line: { color: '#0f172a', width: 1.5, dash: 'dash' } },
        ],
        annotations: [
          { x: metrics.profit_change_p50, yref: 'paper', y: 1.06, text: `Median ${formatSignedPct(metrics.profit_change_p50)}`, showarrow: false, font: { size: 11, color: '#0f172a' } },
        ],
        margin: { l: 52, r: 16, t: 28, b: 48 },
      },
    }),
    [distribution, metrics],
  )
  return <Plot {...chart} height={height} ariaLabel="Distribution of profit change across simulation runs" />
}

export function RiskFactorsChart({ risk, height = 220 }) {
  const chart = useMemo(() => {
    const factors = [...risk.factors].reverse()
    return {
      data: [
        {
          type: 'bar',
          orientation: 'h',
          y: factors.map((factor) => `${factor.name} `),
          x: factors.map((factor) => factor.contribution),
          marker: { color: RISK_COLORS[risk.risk_level] || '#4f46e5' },
          customdata: factors.map((factor) => [factor.description, factor.value, Math.round(factor.weight * 100)]),
          hovertemplate: '%{customdata[0]}<br>Score %{customdata[1]:.0f}/100 · weight %{customdata[2]}%<extra></extra>',
        },
      ],
      layout: {
        margin: { l: 8, r: 16, t: 8, b: 40 },
        xaxis: { title: { text: 'Share of impact (%)' }, ticksuffix: '%' },
      },
    }
  }, [risk])
  return <Plot {...chart} height={height} ariaLabel="What drives the impact of this risk" />
}


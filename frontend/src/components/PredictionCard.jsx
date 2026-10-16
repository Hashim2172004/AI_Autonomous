import { Brain } from 'lucide-react'
import { useState } from 'react'
import { analysisApi, scenariosApi } from '../api'
import { getErrorMessage } from '../api/client'
import { useFetch } from '../hooks/useFetch'
import { formatDateTime, formatNumber } from '../utils/format'
import { ErrorAlert, Spinner } from './ui'

const LABELS = {
  profit_change_pct: ['Profit change', '%'],
  total_cost_change_pct: ['Total cost change', '%'],
  avg_delay_days: ['Average delay', ' days'],
  unmet_demand_pct: ['Unserved demand', '%'],
}

/** ML prediction next to the simulation it approximates. Always labelled as synthetic-trained. */
export default function PredictionCard({ scenario, onChanged }) {
  const model = useFetch(({ signal }) => analysisApi.mlModel({ signal }), [scenario.latest_prediction?.id])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const prediction = scenario.latest_prediction
  const metrics = model.data?.model?.metrics?.test

  const run = async () => {
    setBusy(true)
    setError('')
    try {
      await scenariosApi.predict(scenario.id)
      onChanged?.()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card p-5" aria-labelledby="prediction-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="prediction-title" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Brain className="h-4 w-4 text-indigo-600" aria-hidden="true" />
            ML prediction
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Surrogate model trained on <strong>synthetic</strong> simulator output, not on real historical outcomes. It
            approximates the simulation; it is not a real-world forecast.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={run}
          disabled={busy || model.data?.available === false}
          title={model.data?.available === false ? 'ML prediction is unavailable on this machine' : undefined}
        >
          {busy && <Spinner className="h-4 w-4" />}
          {busy ? 'Predicting…' : prediction ? 'Refresh prediction' : 'Predict'}
        </button>
      </div>
      {model.data?.available === false && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">
          ML prediction is unavailable on this machine: {model.data.unavailable_reason}
        </p>
      )}
      <ErrorAlert message={error} className="mt-3" />

      {prediction ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="py-2 pr-4">Outcome</th>
                <th className="px-4 py-2 text-right">Predicted</th>
                <th className="px-4 py-2 text-right">Model spread</th>
                <th className="px-4 py-2 text-right">Simulated</th>
                <th className="py-2 pl-4 text-right">Difference</th>
                <th className="py-2 pl-4 text-right">Typical error (MAE)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {Object.entries(LABELS).map(([key, [label, unit]]) => (
                <tr key={key}>
                  <td className="py-2 pr-4 text-slate-700">{label}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{formatNumber(prediction.predicted[key], 2)}{unit}</td>
                  <td className="px-4 py-2 text-right text-xs text-slate-500 tabular-nums">
                    {formatNumber(prediction.low[key], 1)} to {formatNumber(prediction.high[key], 1)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {prediction.simulated?.[key] != null ? `${formatNumber(prediction.simulated[key], 2)}${unit}` : '—'}
                  </td>
                  <td className="py-2 pl-4 text-right tabular-nums">
                    {prediction.errors?.[key] != null ? `${prediction.errors[key] > 0 ? '+' : ''}${formatNumber(prediction.errors[key], 2)}` : '—'}
                  </td>
                  <td className="py-2 pl-4 text-right text-xs text-slate-500 tabular-nums">
                    {metrics?.[key] ? `±${formatNumber(metrics[key].mae, 2)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">
            Model spread is the 10th–90th percentile across the trees of the ensemble, not a confidence interval for
            real-world outcomes. Predicted {formatDateTime(prediction.created_at)}.
          </p>
          {prediction.out_of_range?.length > 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">
              Outside the range the model was trained on ({prediction.out_of_range.join(', ')}): treat this prediction as
              an extrapolation.
            </p>
          )}
          {!prediction.assumptions_match && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">
              The latest simulation used different assumptions than the model was trained with; the difference above
              mixes model error and the assumption change. Retrain from the dashboard to align them.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">
          No prediction yet. The first prediction trains the model, which takes a few seconds.
        </p>
      )}
    </section>
  )
}

import { Brain } from 'lucide-react'
import { useState } from 'react'
import { analysisApi } from '../api'
import { getErrorMessage } from '../api/client'
import { useFetch } from '../hooks/useFetch'
import { formatDate, formatNumber } from '../utils/format'
import { ErrorAlert, Spinner } from './ui'

/** Held-out error metrics of the prediction model. `model` is the dashboard's ml_model object. */
export default function MlModelCard({ model, onTrained }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const train = async () => {
    setBusy(true)
    setError('')
    try {
      await analysisApi.trainModel()
      onTrained?.()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  const status = useFetch(({ signal }) => analysisApi.mlModel({ signal }), [model?.id])
  const unavailable = status.data && status.data.available === false
  const test = model?.metrics?.test
  return (
    <section className="card p-5" aria-labelledby="ml-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="ml-title" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Brain className="h-4 w-4 text-indigo-600" aria-hidden="true" />
            Prediction model
          </h2>
          {model ? (
            <p className="mt-0.5 text-xs text-slate-500">
              {model.algorithm} · trained {formatDate(model.created_at)} on {model.n_samples} synthetic simulations (
              {model.n_test} held out for testing)
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-slate-500">Not trained yet. It trains automatically on the first prediction.</p>
          )}
        </div>
        <button type="button" className="btn btn-secondary" onClick={train} disabled={busy || unavailable}>
          {busy && <Spinner className="h-4 w-4" />}
          {busy ? 'Training…' : model ? 'Retrain' : 'Train now'}
        </button>
      </div>
      {unavailable && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">
          ML prediction is unavailable on this machine: {status.data.unavailable_reason}
        </p>
      )}
      <ErrorAlert message={error} className="mt-3" />

      {test && (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="py-2 pr-4">Outcome</th>
                <th className="px-3 py-2 text-right">MAE</th>
                <th className="px-3 py-2 text-right">RMSE</th>
                <th className="px-3 py-2 text-right">R²</th>
                <th className="px-3 py-2 text-right">Mean-guess MAE</th>
                <th className="py-2 pl-3 text-right">CV R²</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {Object.entries(test).map(([target, m]) => (
                <tr key={target}>
                  <td className="py-2 pr-4 text-slate-700">{model.target_labels?.[target] || target}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(m.mae, 2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(m.rmse, 2)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{formatNumber(m.r2, 3)}</td>
                  <td className="px-3 py-2 text-right text-slate-500 tabular-nums">{formatNumber(m.baseline_mae, 2)}</td>
                  <td className="py-2 pl-3 text-right text-slate-500 tabular-nums">
                    {formatNumber(m.cv_r2_mean, 2)} ± {formatNumber(m.cv_r2_std, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{model.disclaimer}</p>
          <p className="mt-2 text-xs text-slate-500">
            MAE / RMSE / R² are measured on held-out synthetic scenarios, i.e. how closely the model reproduces the
            simulator. “Mean-guess MAE” is the error of always predicting the average, the bar a useful model must beat.
          </p>
        </div>
      )}
    </section>
  )
}

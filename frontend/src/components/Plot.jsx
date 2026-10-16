import { useEffect, useRef, useState } from 'react'
import { Spinner } from './ui'

// Plotly is large, so it is loaded on demand and shared by all charts.
let plotlyPromise = null
const loadPlotly = () => {
  plotlyPromise ??= import('plotly.js-cartesian-dist-min').then((module) => module.default ?? module)
  return plotlyPromise
}

const BASE_LAYOUT = {
  autosize: true,
  margin: { l: 48, r: 16, t: 16, b: 44 },
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: 'Inter, ui-sans-serif, system-ui, sans-serif', size: 12, color: '#475569' },
  colorway: ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316'],
  hoverlabel: { font: { family: 'Inter, ui-sans-serif, system-ui, sans-serif', size: 12 } },
}

const AXIS = { gridcolor: '#e2e8f0', zerolinecolor: '#cbd5e1', linecolor: '#cbd5e1', automargin: true }

/** Thin Plotly wrapper. Memoise `data` and `layout` in the caller to avoid needless redraws. */
export default function Plot({ data, layout, height = 320, ariaLabel }) {
  const ref = useRef(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadPlotly()
      .then((Plotly) => {
        if (cancelled || !ref.current) return
        const merged = {
          ...BASE_LAYOUT,
          ...layout,
          xaxis: { ...AXIS, ...layout?.xaxis },
          yaxis: { ...AXIS, ...layout?.yaxis },
        }
        Plotly.react(ref.current, data, merged, { displayModeBar: false, responsive: true })
        setReady(true)
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [data, layout])

  useEffect(() => {
    const element = ref.current
    return () => {
      if (element) loadPlotly().then((Plotly) => Plotly.purge(element))
    }
  }, [])

  return (
    <div className="relative w-full" style={{ height }}>
      {!ready && !failed && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400">
          <Spinner />
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-red-600">
          The chart could not be loaded.
        </div>
      )}
      <div ref={ref} className="h-full w-full" role="img" aria-label={ariaLabel} />
    </div>
  )
}

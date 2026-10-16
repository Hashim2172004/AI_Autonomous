import { useNavigate } from 'react-router-dom'

const SEVERITY_FILL = { low: '#10b981', mild: '#10b981', moderate: '#f59e0b', high: '#f97316', severe: '#f97316', critical: '#dc2626' }
const NODE_W = 235
const NODE_H = 40
const ROW = 54
const COLUMN_GAP = 90

const truncate = (text, length) => (text.length > length ? `${text.slice(0, length - 1)}…` : text)

/**
 * Two-column relationship graph: base scenarios on the left, the compound scenarios that
 * combine them on the right, with a line from each component to each compound.
 */
export default function ScenarioGraph({ scenarios, relationships }) {
  const navigate = useNavigate()
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]))
  const linked = new Set(relationships.flatMap((link) => [link.source_scenario_id, link.target_scenario_id]))

  const compounds = scenarios.filter((scenario) => scenario.details?.kind === 'compound')
  const bases = scenarios.filter((scenario) => scenario.details?.kind !== 'compound')
  if (!relationships.length) return null

  // Bases that take part in a combination first, so the lines stay short.
  bases.sort((a, b) => Number(linked.has(b.id)) - Number(linked.has(a.id)) || (a.rank ?? 99) - (b.rank ?? 99))

  const position = new Map()
  bases.forEach((scenario, index) => position.set(scenario.id, { x: 0, y: 12 + index * ROW }))
  const compoundSpan = Math.max(0, bases.length - compounds.length) * ROW
  compounds.forEach((scenario, index) =>
    position.set(scenario.id, { x: NODE_W + COLUMN_GAP, y: 12 + index * ROW + Math.min(compoundSpan / 2, ROW * 2) }),
  )
  const width = NODE_W * 2 + COLUMN_GAP
  const height = 24 + Math.max(bases.length, compounds.length + 1) * ROW

  const renderNode = (scenario) => {
    const { x, y } = position.get(scenario.id)
    const fill = SEVERITY_FILL[scenario.severity] || '#64748b'
    const probability = scenario.parameters?.probability
    return (
      <g
        key={scenario.id}
        transform={`translate(${x},${y})`}
        className="cursor-pointer"
        onClick={() => navigate(`/scenarios/${scenario.id}`)}
        role="link"
        tabIndex={0}
        onKeyDown={(event) => event.key === 'Enter' && navigate(`/scenarios/${scenario.id}`)}
        aria-label={`${scenario.scenario_key} ${scenario.title}`}
      >
        <title>{`${scenario.title} — severity ${scenario.severity}, probability ${probability != null ? Math.round(probability * 100) : '?'}%`}</title>
        <rect width={NODE_W} height={NODE_H} rx={8} fill="white" stroke="#cbd5e1" />
        <rect width={6} height={NODE_H} rx={3} fill={fill} />
        <text x={16} y={17} fontSize={11} fontWeight={600} fill="#0f172a">
          {scenario.scenario_key} · {truncate(scenario.title, 30)}
        </text>
        <text x={16} y={32} fontSize={10} fill="#64748b">
          {scenario.severity} · p={probability != null ? `${Math.round(probability * 100)}%` : '—'}
          {scenario.confidence != null ? ` · conf ${Math.round(scenario.confidence * 100)}%` : ''}
        </text>
      </g>
    )
  }

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Scenario relationships">
        {relationships.map((link) => {
          const from = position.get(link.source_scenario_id)
          const to = position.get(link.target_scenario_id)
          if (!from || !to || !byId.has(link.source_scenario_id) || !byId.has(link.target_scenario_id)) return null
          const x1 = from.x + NODE_W
          const y1 = from.y + NODE_H / 2
          const x2 = to.x
          const y2 = to.y + NODE_H / 2
          const mid = (x1 + x2) / 2
          return (
            <path
              key={link.id}
              d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
              fill="none"
              stroke="#818cf8"
              strokeWidth={1.5}
              opacity={0.7}
            />
          )
        })}
        {bases.map(renderNode)}
        {compounds.map(renderNode)}
        <text x={0} y={height - 2} fontSize={10} fill="#94a3b8">
          Base scenarios
        </text>
        <text x={NODE_W + COLUMN_GAP} y={height - 2} fontSize={10} fill="#94a3b8">
          Combined scenarios (line = is a component of)
        </text>
      </svg>
    </div>
  )
}

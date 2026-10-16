import { Link, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import AuthPage from './pages/AuthPage'
import CreateScenario from './pages/CreateScenario'
import Dashboard from './pages/Dashboard'
import GenerationRun from './pages/GenerationRun'
import GenerationRuns from './pages/GenerationRuns'
import Knowledge from './pages/Knowledge'
import ScenarioDetails from './pages/ScenarioDetails'
import Scenarios from './pages/Scenarios'
import SimulationDetail from './pages/SimulationDetail'
import SimulationResults from './pages/SimulationResults'

function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-sm font-semibold text-indigo-600">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Page not found</h1>
      <Link to="/" className="btn btn-primary mt-6">
        Back to dashboard
      </Link>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="scenarios" element={<Scenarios />} />
          <Route path="scenarios/new" element={<CreateScenario />} />
          <Route path="scenarios/:id" element={<ScenarioDetails />} />
          <Route path="generation" element={<GenerationRuns />} />
          <Route path="generation/:id" element={<GenerationRun />} />
          <Route path="knowledge" element={<Knowledge />} />
          <Route path="simulations" element={<SimulationResults />} />
          <Route path="simulations/:id" element={<SimulationDetail />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  )
}

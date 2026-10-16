import { TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { getErrorMessage, getFieldErrors } from '../api/client'
import { ErrorAlert, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validate(values, isRegister) {
  const errors = {}
  if (isRegister && !values.full_name.trim()) errors.full_name = 'Enter your name'
  if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = 'Enter a valid email address'
  if (!values.password) errors.password = 'Enter your password'
  else if (isRegister && values.password.length < 8) errors.password = 'Use at least 8 characters'
  if (isRegister && values.password !== values.confirm_password) errors.confirm_password = 'Passwords do not match'
  return errors
}

function Field({ id, label, error, ...props }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        name={id}
        className={`input ${error ? 'border-red-400' : ''}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

export default function AuthPage({ mode }) {
  const isRegister = mode === 'register'
  const { user, initializing, login, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [values, setValues] = useState({ full_name: '', email: '', password: '', confirm_password: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const destination = location.state?.from?.pathname || '/'
  if (!initializing && user) return <Navigate to={destination} replace />

  const handleChange = (event) => {
    const { name, value } = event.target
    setValues((previous) => ({ ...previous, [name]: value }))
    setErrors((previous) => ({ ...previous, [name]: undefined }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const validation = validate(values, isRegister)
    setErrors(validation)
    setFormError('')
    if (Object.keys(validation).length) return

    setSubmitting(true)
    try {
      const credentials = { email: values.email.trim(), password: values.password }
      if (isRegister) await register({ ...credentials, full_name: values.full_name.trim() })
      else await login(credentials)
      navigate(destination, { replace: true })
    } catch (error) {
      const fieldErrors = getFieldErrors(error)
      setErrors(fieldErrors)
      if (!Object.keys(fieldErrors).length) setFormError(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-slate-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500">
            <TrendingUp className="h-5 w-5" aria-hidden="true" />
          </div>
          <span className="text-base font-semibold">Scenario Generator</span>
        </div>
        <div>
          <h2 className="max-w-md text-3xl leading-tight font-semibold">
            Explore what could happen to your system before it does.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-300">
            Describe a business or industrial system, generate realistic what-if scenarios, simulate their impact and
            see where the risk concentrates.
          </p>
        </div>
        <p className="text-xs text-slate-500">AI Autonomous Scenario Generator</p>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {isRegister ? 'Create your account' : 'Sign in'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isRegister ? 'Already have an account? ' : 'New here? '}
            <Link
              to={isRegister ? '/login' : '/register'}
              state={location.state}
              className="font-medium text-indigo-600 hover:text-indigo-700"
            >
              {isRegister ? 'Sign in' : 'Create an account'}
            </Link>
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
            <ErrorAlert message={formError} />
            {isRegister && (
              <Field
                id="full_name"
                label="Full name"
                autoComplete="name"
                value={values.full_name}
                onChange={handleChange}
                error={errors.full_name}
              />
            )}
            <Field
              id="email"
              label="Email"
              type="email"
              autoComplete="email"
              value={values.email}
              onChange={handleChange}
              error={errors.email}
            />
            <Field
              id="password"
              label="Password"
              type="password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              value={values.password}
              onChange={handleChange}
              error={errors.password}
            />
            {isRegister && (
              <Field
                id="confirm_password"
                label="Confirm password"
                type="password"
                autoComplete="new-password"
                value={values.confirm_password}
                onChange={handleChange}
                error={errors.confirm_password}
              />
            )}
            <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
              {submitting && <Spinner className="h-4 w-4" />}
              {isRegister ? 'Create account' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

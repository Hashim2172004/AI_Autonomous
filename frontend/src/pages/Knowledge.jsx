import { BookOpen, Search, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { generationApi, knowledgeApi, systemsApi } from '../api'
import { getErrorMessage, getFieldErrors } from '../api/client'
import { ConfirmDialog, EmptyState, ErrorAlert, LoadingState, PageHeader, Spinner } from '../components/ui'
import { useFetch } from '../hooks/useFetch'
import { formatDate } from '../utils/format'

export default function Knowledge() {
  const documents = useFetch(({ signal }) => knowledgeApi.list({ signal }))
  const aiConfig = useFetch(({ signal }) => generationApi.config({ signal }))
  const systems = useFetch(({ signal }) => systemsApi.list({}, { signal }))
  const fileInput = useRef(null)

  const [form, setForm] = useState({ title: '', content: '', source: '', system_id: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')

  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const change = (event) => {
    const { name, value } = event.target
    setForm((previous) => ({ ...previous, [name]: value }))
    setErrors((previous) => ({ ...previous, [name]: undefined }))
  }

  const finish = (document) => {
    setNotice(`“${document.title}” indexed as ${document.chunk_count} passage${document.chunk_count === 1 ? '' : 's'}.`)
    documents.reload()
  }

  const submit = async (event) => {
    event.preventDefault()
    const validation = {}
    if (form.title.trim().length < 2) validation.title = 'Enter a title'
    if (form.content.trim().length < 20) validation.content = 'Enter at least 20 characters of text'
    setErrors(validation)
    setFormError('')
    setNotice('')
    if (Object.keys(validation).length) return
    setSaving(true)
    try {
      const document = await knowledgeApi.create({
        title: form.title,
        content: form.content,
        source: form.source,
        system_id: form.system_id ? Number(form.system_id) : null,
      })
      setForm({ title: '', content: '', source: '', system_id: form.system_id })
      finish(document)
    } catch (error) {
      const fieldErrors = getFieldErrors(error)
      setErrors(fieldErrors)
      setFormError(Object.keys(fieldErrors).length ? 'Please correct the highlighted fields.' : getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const upload = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setSaving(true)
    setFormError('')
    setNotice('')
    try {
      finish(await knowledgeApi.upload(file, form.title.trim()))
    } catch (error) {
      setFormError(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const search = async (event) => {
    event.preventDefault()
    if (query.trim().length < 2) return
    setSearching(true)
    setSearchError('')
    try {
      setHits(await knowledgeApi.search({ query: query.trim(), top_k: 5 }))
    } catch (error) {
      setSearchError(getErrorMessage(error))
    } finally {
      setSearching(false)
    }
  }

  const confirmDelete = async () => {
    setDeleting(true)
    try {
      await knowledgeApi.remove(pendingDelete.id)
      setPendingDelete(null)
      documents.reload()
    } catch (error) {
      setFormError(getErrorMessage(error))
      setPendingDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const systemName = (id) => systems.data?.find((system) => system.id === id)?.name

  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Reference documents the agent retrieves from before generating scenarios: incident reports, manuals, policies, market notes."
      />

      {aiConfig.data?.embedding_warning && (
        <div role="alert" className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Embedding model not available</p>
          <p className="mt-0.5">{aiConfig.data.embedding_warning}</p>
        </div>
      )}
      {aiConfig.data && !aiConfig.data.embedding_warning && (
        <p className="mb-4 text-xs text-slate-500">
          Embeddings: {aiConfig.data.embedding_model}
          {aiConfig.data.embedding_runtime && ` · ${aiConfig.data.embedding_runtime}`}
          {aiConfig.data.embedding_note && ` — ${aiConfig.data.embedding_note}`}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <form onSubmit={submit} noValidate className="card space-y-4 p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">Add a document</h2>
          <ErrorAlert message={formError} />
          {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{notice}</p>}
          <div>
            <label htmlFor="title" className="label">Title</label>
            <input id="title" name="title" className={`input ${errors.title ? 'border-red-400' : ''}`} value={form.title} onChange={change} maxLength={300} />
            {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title}</p>}
          </div>
          <div>
            <label htmlFor="content" className="label">Text</label>
            <textarea id="content" name="content" rows={8} className={`input ${errors.content ? 'border-red-400' : ''}`} value={form.content} onChange={change} placeholder="Paste text here, or upload a file below." />
            {errors.content && <p className="mt-1 text-xs text-red-600">{errors.content}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="source" className="label">Source (optional)</label>
              <input id="source" name="source" className="input" value={form.source} onChange={change} placeholder="e.g. Maintenance manual v3" />
            </div>
            <div>
              <label htmlFor="system_id" className="label">Applies to</label>
              <select id="system_id" name="system_id" className="input" value={form.system_id} onChange={change}>
                <option value="">All my systems</option>
                {(systems.data || []).map((system) => (
                  <option key={system.id} value={system.id}>{system.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving && <Spinner className="h-4 w-4" />}
              Add and index
            </button>
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => fileInput.current?.click()}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              Upload file
            </button>
            <input ref={fileInput} type="file" accept=".txt,.md,.markdown,.csv,.json,.log,.rst,text/*" className="hidden" onChange={upload} />
          </div>
          <p className="text-xs text-slate-500">Text files up to 2 MB. Documents are split into passages and indexed with TF-IDF keyword similarity.</p>
        </form>

        <div className="space-y-6 lg:col-span-3">
          <section className="card overflow-hidden">
            <h2 className="px-5 py-4 text-sm font-semibold text-slate-900">Documents</h2>
            {documents.loading && !documents.data ? (
              <LoadingState label="Loading documents…" />
            ) : documents.error && !documents.data ? (
              <div className="p-4"><ErrorAlert message={documents.error} onRetry={documents.reload} /></div>
            ) : documents.data.length === 0 ? (
              <EmptyState icon={BookOpen} title="No documents yet" description="Add text on the left. Runs without documents fall back to the model's general knowledge." />
            ) : (
              <ul className="divide-y divide-slate-100 border-t border-slate-100">
                {documents.data.map((document) => (
                  <li key={document.id} className="flex items-start gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{document.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{document.preview}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {document.chunk_count} passages · {document.characters.toLocaleString()} characters ·{' '}
                        {document.system_id ? systemName(document.system_id) || 'one system' : 'all systems'} · {formatDate(document.created_at)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() => setPendingDelete(document)}
                      aria-label={`Delete ${document.title}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold text-slate-900">Test retrieval</h2>
            <p className="mt-0.5 text-xs text-slate-500">See which passages the agent would retrieve for a query.</p>
            <form onSubmit={search} className="mt-3 flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" aria-hidden="true" />
                <input className="input pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. supplier delays" aria-label="Search the knowledge base" />
              </div>
              <button type="submit" className="btn btn-secondary" disabled={searching}>
                {searching && <Spinner className="h-4 w-4" />}
                Search
              </button>
            </form>
            <ErrorAlert message={searchError} className="mt-3" />
            {hits && (
              <ul className="mt-4 space-y-3">
                {hits.length === 0 && <li className="text-sm text-slate-500">No matching passages.</li>}
                {hits.map((hit, index) => (
                  <li key={index} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="font-medium text-slate-800">
                      {hit.title} <span className="text-xs font-normal text-slate-400">relevance {Math.round(hit.score * 100)}%</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-600">{hit.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete document?"
        message={`“${pendingDelete?.title}” and its embeddings will be removed from the knowledge base.`}
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const templates = [
  {
    id: 'blank',
    name: 'Blank Book',
    description: 'Empty book with basic formatting. Good starting point for any project.',
  },
  {
    id: 'hebrew-english',
    name: 'Hebrew-English Bilingual',
    description: 'Side-by-side bilingual layout using paracol. RTL Hebrew support built in.',
  },
]

export default function NewProjectPage() {
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState('blank')
  const [pageCount, setPageCount] = useState(10)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleCreate() {
    setLoading(true)
    const res = await fetch('/api/project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || 'Untitled Book', templateId, pageCount }),
    })

    if (res.ok) {
      const project = await res.json()
      router.push(`/project/${project.id}`)
    } else {
      setLoading(false)
      alert('Failed to create project')
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4">
        <h1 className="text-xl font-bold">New Book</h1>
      </header>

      <main className="max-w-lg mx-auto p-6 space-y-6">
        <div>
          <label className="text-sm font-medium">Book Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled Book"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="text-sm font-medium">Template</label>
          <div className="mt-2 grid gap-3">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setTemplateId(t.id)}
                className={`text-left rounded-lg border p-4 transition-colors ${
                  templateId === t.id
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-primary/30'
                }`}
              >
                <p className="font-medium">{t.name}</p>
                <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">Page Count</label>
          <input
            type="number"
            value={pageCount}
            onChange={(e) => setPageCount(Math.max(2, Math.min(100, Number(e.target.value))))}
            min={2}
            max={100}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">You can always add or remove pages later via the AI.</p>
        </div>

        <button
          onClick={handleCreate}
          disabled={loading}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Book'}
        </button>
      </main>
    </div>
  )
}

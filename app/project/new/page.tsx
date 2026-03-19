'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const templates = [
  {
    id: 'haggadah',
    name: 'Passover Haggadah',
    description: 'Complete Haggadah Shel Pesach with Hebrew/English bilingual text, decorative ornaments, and all 15 seder steps.',
    icon: '🍷',
    color: 'from-amber-600 to-red-700',
    fixedPages: true,
  },
  {
    id: 'haggadah-kids',
    name: "Children's Haggadah",
    description: "Kid-friendly Passover Haggadah with cartoon illustrations, playful fonts, and bright colors. Same complete text as the adult version.",
    icon: '🌟',
    color: 'from-orange-400 to-purple-500',
    fixedPages: true,
  },
  {
    id: 'hebrew-english',
    name: 'Hebrew-English Bilingual',
    description: 'Side-by-side bilingual layout with built-in Hebrew support and right-to-left formatting.',
    icon: '📖',
    color: 'from-purple-500 to-pink-500',
  },
  {
    id: 'blank',
    name: 'Blank Book',
    description: 'Start fresh with a clean layout. Perfect for any book project.',
    icon: '📄',
    color: 'from-blue-500 to-cyan-500',
  },
]

export default function NewProjectPage() {
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState('haggadah')
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
    <div className="min-h-screen gradient-bg-subtle">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-xl border-b sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/logo.png" alt="Shluchim Exchange" className="w-7 h-7 rounded-lg object-contain" />
            <span className="text-sm font-bold">Shluchim Exchange</span>
          </Link>
          <span className="text-muted-foreground text-sm">/</span>
          <span className="text-sm font-medium">New Book</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold">Create a new book</h1>
          <p className="text-muted-foreground mt-2">Choose a template and start customizing with AI</p>
        </div>

        <div className="bg-white rounded-2xl border border-purple-100 p-8 shadow-sm space-y-8">
          {/* Book name */}
          <div>
            <label className="text-sm font-medium">Book name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Amazing Book"
              className="mt-2 w-full rounded-xl border border-purple-100 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-300 transition-colors"
            />
          </div>

          {/* Template selection */}
          <div>
            <label className="text-sm font-medium">Template</label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTemplateId(t.id)}
                  className={`text-left rounded-xl border-2 p-5 transition-all ${
                    templateId === t.id
                      ? 'border-purple-500 bg-purple-50/50 shadow-md shadow-purple-500/10'
                      : 'border-purple-100 hover:border-purple-200 hover:bg-purple-50/30'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${t.color} flex items-center justify-center text-lg shrink-0`}>
                      {t.icon}
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{t.name}</p>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t.description}</p>
                    </div>
                  </div>
                  {templateId === t.id && (
                    <div className="mt-3 flex items-center gap-1.5 text-purple-600">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-xs font-medium">Selected</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Page count — hidden for templates with fixed pages */}
          {!templates.find(t => t.id === templateId)?.fixedPages && (
            <div>
              <label className="text-sm font-medium">Number of pages</label>
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="range"
                  value={pageCount}
                  onChange={(e) => setPageCount(Number(e.target.value))}
                  min={2}
                  max={100}
                  className="flex-1 accent-purple-600"
                />
                <span className="text-sm font-medium text-purple-700 bg-purple-50 rounded-lg px-3 py-1 min-w-[60px] text-center">
                  {pageCount}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">You can always add or remove pages later by asking the AI.</p>
            </div>
          )}

          {/* Create button */}
          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full rounded-xl gradient-bg px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg shadow-purple-500/25"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Creating your book...
              </span>
            ) : (
              'Create Book'
            )}
          </button>
        </div>
      </main>
    </div>
  )
}

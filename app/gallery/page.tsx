'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface GalleryProject {
  id: string
  name: string
  description: string
  page_count: number
  fork_count: number
  created_at: string
  profiles?: { display_name: string; avatar_url?: string }
}

export default function GalleryPage() {
  const [projects, setProjects] = useState<GalleryProject[]>([])
  const [sort, setSort] = useState<'newest' | 'forks'>('newest')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/gallery?sort=${sort}`)
      .then(res => res.json())
      .then(data => {
        setProjects(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [sort])

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-xl border-b sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-0">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <img src="/logo.png" alt="Shluchim Exchange" className="w-7 h-7 rounded-lg object-contain" />
              <span className="text-sm font-bold">Shluchim Exchange</span>
            </Link>
            <span className="text-muted-foreground text-sm">/</span>
            <span className="text-sm font-medium">Gallery</span>
          </div>
          <div className="flex items-center gap-1 bg-purple-50 rounded-xl p-1 self-start sm:self-auto">
            <button
              onClick={() => setSort('newest')}
              className={`rounded-lg px-3 sm:px-4 py-1.5 min-h-[44px] text-xs font-medium transition-all ${
                sort === 'newest'
                  ? 'bg-white text-purple-700 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Newest
            </button>
            <button
              onClick={() => setSort('forks')}
              className={`rounded-lg px-3 sm:px-4 py-1.5 min-h-[44px] text-xs font-medium transition-all ${
                sort === 'forks'
                  ? 'bg-white text-purple-700 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Most Popular
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="gradient-bg-subtle border-b">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 text-center">
          <h1 className="text-2xl sm:text-3xl font-bold">Community Gallery</h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-2">Discover books created by the community. Fork any project to make it your own.</p>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="rounded-2xl border border-purple-100 bg-white p-5 animate-pulse">
                <div className="h-4 bg-purple-100 rounded w-3/4 mb-3" />
                <div className="h-3 bg-purple-50 rounded w-full mb-2" />
                <div className="h-3 bg-purple-50 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl gradient-bg-subtle flex items-center justify-center mx-auto mb-4">
              <span className="text-purple-600 text-2xl">📚</span>
            </div>
            <p className="text-muted-foreground font-medium">No public books yet</p>
            <p className="text-sm text-muted-foreground mt-1">Be the first to share a creation!</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map(p => (
              <Link
                key={p.id}
                href={`/view/${p.id}`}
                className="group block rounded-2xl border border-purple-100 bg-white p-5 hover:border-purple-300 hover:shadow-lg hover:shadow-purple-500/5 transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl gradient-bg-subtle flex items-center justify-center shrink-0">
                    <span className="text-purple-600 font-bold text-sm">
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate group-hover:text-purple-700 transition-colors">
                      {p.name}
                    </h3>
                    {p.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                        {p.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {p.page_count} pages
                  </span>
                  {p.fork_count > 0 && (
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                      </svg>
                      {p.fork_count} forks
                    </span>
                  )}
                  {p.profiles?.display_name && (
                    <span className="ml-auto">by {p.profiles.display_name}</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

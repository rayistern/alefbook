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
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-xl font-bold hover:text-primary">AlefBook</Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium">Gallery</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSort('newest')}
            className={`rounded-md px-3 py-1.5 text-xs ${sort === 'newest' ? 'bg-primary text-primary-foreground' : 'border hover:bg-accent'}`}
          >
            Newest
          </button>
          <button
            onClick={() => setSort('forks')}
            className={`rounded-md px-3 py-1.5 text-xs ${sort === 'forks' ? 'bg-primary text-primary-foreground' : 'border hover:bg-accent'}`}
          >
            Most Forked
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6">
        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No public books yet. Be the first to share!</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map(p => (
              <Link
                key={p.id}
                href={`/view/${p.id}`}
                className="block rounded-lg border p-4 hover:border-primary/50 transition-colors"
              >
                <h3 className="font-semibold truncate">{p.name}</h3>
                {p.description && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{p.description}</p>
                )}
                <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                  <span>{p.page_count} pages</span>
                  {p.fork_count > 0 && <span>{p.fork_count} forks</span>}
                  {p.profiles?.display_name && <span>by {p.profiles.display_name}</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

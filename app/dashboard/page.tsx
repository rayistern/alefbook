'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { Plus, BookOpen } from 'lucide-react'

interface Project {
  id: string
  name: string
  status: string
  template_id: string
  created_at: string
  updated_at: string
  cover_url?: string
}

export default function DashboardPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    fetchProjects()
  }, [])

  async function fetchProjects() {
    try {
      const res = await fetch('/api/project')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const projectList = data.projects ?? []
      setProjects(projectList)

      // Fetch cover thumbnails for each project
      const urls: Record<string, string> = {}
      await Promise.all(
        projectList.map(async (p: Project) => {
          try {
            const renderRes = await fetch('/api/render', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectId: p.id, pageNumbers: [1] }),
            })
            if (renderRes.ok) {
              const renderData = await renderRes.json()
              if (renderData.renderUrls?.[1]) {
                urls[p.id] = renderData.renderUrls[1]
              }
            }
          } catch {
            // Ignore individual render failures
          }
        })
      )
      setCoverUrls(urls)
    } catch (error) {
      console.error('Failed to load projects:', error)
    } finally {
      setLoading(false)
    }
  }

  async function createProject() {
    try {
      const res = await fetch('/api/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Haggadah' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || 'Failed to create project')
      }
      const project = await res.json()
      router.push(`/designer/${project.id}`)
    } catch (error) {
      console.error('Failed to create project:', error)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <h1 className="text-xl font-semibold">AlefBook</h1>
          <UserButton />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">My Haggadot</h2>
          <Button onClick={createProject}>
            <Plus className="mr-2 h-4 w-4" />
            New Haggadah
          </Button>
        </div>

        {loading ? (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-64 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="mt-16 flex flex-col items-center gap-4 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground" />
            <p className="text-lg text-muted-foreground">
              No Haggadot yet. Create your first one!
            </p>
            <Button onClick={createProject}>
              <Plus className="mr-2 h-4 w-4" />
              Create Haggadah
            </Button>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map(project => (
              <button
                key={project.id}
                onClick={() => router.push(`/designer/${project.id}`)}
                className="group flex flex-col overflow-hidden rounded-lg border text-left transition-colors hover:bg-accent"
              >
                {/* Thumbnail */}
                <div className="relative h-40 w-full overflow-hidden bg-muted">
                  {coverUrls[project.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={coverUrls[project.id]}
                      alt={`${project.name} cover`}
                      className="h-full w-full object-contain transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <BookOpen className="h-10 w-10 text-muted-foreground/40" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{project.name}</span>
                  </div>
                  <span className="mt-1 inline-block text-sm text-muted-foreground">
                    {project.status === 'draft' ? 'Draft' : project.status === 'completed' ? 'Completed' : 'Ordered'}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Updated {new Date(project.updated_at).toLocaleDateString()}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

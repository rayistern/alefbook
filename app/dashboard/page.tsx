'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
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
}

export default function DashboardPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchProjects()
  }, [])

  async function fetchProjects() {
    try {
      const res = await fetch('/api/project')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setProjects(data.projects ?? [])
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
      <header className="border-b border-border/50">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Image
            src="/images/LOGO11B-2X1.png"
            alt="AlefBook"
            width={120}
            height={60}
            className="h-8 w-auto"
          />
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
              <div key={i} className="h-48 animate-pulse rounded-xl bg-card border border-border/50" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="mt-16 flex flex-col items-center gap-4 text-center">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <BookOpen className="h-8 w-8 text-primary" />
            </div>
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
                className="flex flex-col rounded-xl border border-border/50 bg-card p-5 text-left transition-all hover:border-primary/30 hover:bg-card/80"
              >
                <div className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" />
                  <span className="font-medium">{project.name}</span>
                </div>
                <span className="mt-2 text-sm text-muted-foreground">
                  {project.status === 'draft' ? 'Draft' : project.status === 'completed' ? 'Completed' : 'Ordered'}
                </span>
                <span className="mt-1 text-xs text-muted-foreground">
                  Updated {new Date(project.updated_at).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

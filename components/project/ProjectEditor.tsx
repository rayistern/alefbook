'use client'

import { useState, useCallback } from 'react'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { PdfViewer } from '@/components/pdf/PdfViewer'
import { ShareDialog } from '@/components/project/ShareDialog'
import Link from 'next/link'

interface Message {
  id: string
  role: string
  content: string
  metadata?: unknown
  created_at: string
}

interface Project {
  id: string
  name: string
  status: string
  is_public: boolean
  page_count: number
  pdf_path?: string
}

export function ProjectEditor({
  project,
  pdfUrl: initialPdfUrl,
  initialMessages,
  isOwner,
}: {
  project: Project
  pdfUrl: string | null
  initialMessages: Message[]
  isOwner: boolean
}) {
  const [pdfUrl, setPdfUrl] = useState(initialPdfUrl)
  const [pdfKey, setPdfKey] = useState(0) // force re-render on new PDF
  const [compiling, setCompiling] = useState(false)
  const [showShare, setShowShare] = useState(false)

  const refreshPdf = useCallback(async () => {
    const res = await fetch(`/api/project/${project.id}`)
    if (res.ok) {
      const data = await res.json()
      if (data.pdfUrl) {
        setPdfUrl(data.pdfUrl)
        setPdfKey(k => k + 1)
      }
    }
  }, [project.id])

  const handleCompile = useCallback(async () => {
    setCompiling(true)
    try {
      const res = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.pdfUrl) {
          setPdfUrl(data.pdfUrl)
          setPdfKey(k => k + 1)
        }
      }
    } finally {
      setCompiling(false)
    }
  }, [project.id])

  const handleChatDone = useCallback(() => {
    // After the AI finishes, refresh PDF
    refreshPdf()
  }, [refreshPdf])

  const handleFork = useCallback(async () => {
    const res = await fetch(`/api/project/${project.id}/fork`, { method: 'POST' })
    if (res.ok) {
      const fork = await res.json()
      window.location.href = `/project/${fork.id}`
    }
  }, [project.id])

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-bold hover:text-primary">
            AlefBook
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium truncate max-w-[200px]">{project.name}</span>
          {compiling && (
            <span className="text-xs text-muted-foreground animate-pulse">Compiling...</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isOwner && (
            <>
              <button
                onClick={handleCompile}
                disabled={compiling}
                className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
              >
                Recompile
              </button>
              <button
                onClick={() => setShowShare(true)}
                className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
              >
                Share
              </button>
            </>
          )}
          {!isOwner && (
            <button
              onClick={handleFork}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
            >
              Fork
            </button>
          )}
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            >
              Download PDF
            </a>
          )}
        </div>
      </header>

      {/* Main content: Chat + PDF */}
      <div className="flex-1 flex min-h-0">
        {/* Chat Panel (left) */}
        {isOwner && (
          <div className="w-[400px] border-r flex flex-col shrink-0">
            <ChatPanel
              projectId={project.id}
              initialMessages={initialMessages}
              onDone={handleChatDone}
            />
          </div>
        )}

        {/* PDF Canvas (right) */}
        <div className="flex-1 bg-muted/30">
          <PdfViewer key={pdfKey} url={pdfUrl} />
        </div>
      </div>

      {showShare && (
        <ShareDialog
          projectId={project.id}
          isPublic={project.is_public}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  )
}

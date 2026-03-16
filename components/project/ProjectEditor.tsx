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
  const [pdfKey, setPdfKey] = useState(0)
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
      <header className="bg-white border-b px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-7 h-7 rounded-lg gradient-bg flex items-center justify-center">
              <span className="text-white font-bold text-xs">A</span>
            </div>
          </Link>
          <div className="w-px h-5 bg-purple-100" />
          <span className="text-sm font-medium truncate max-w-[200px]">{project.name}</span>
          {compiling && (
            <span className="flex items-center gap-1.5 text-xs text-purple-600">
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Generating...
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isOwner && (
            <>
              <button
                onClick={handleCompile}
                disabled={compiling}
                className="rounded-lg border border-purple-100 px-3 py-1.5 text-xs font-medium hover:bg-purple-50 hover:border-purple-200 disabled:opacity-50 transition-colors"
              >
                Regenerate PDF
              </button>
              <button
                onClick={() => setShowShare(true)}
                className="rounded-lg border border-purple-100 px-3 py-1.5 text-xs font-medium hover:bg-purple-50 hover:border-purple-200 transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Share
              </button>
            </>
          )}
          {!isOwner && (
            <button
              onClick={handleFork}
              className="rounded-lg gradient-bg px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity shadow-sm shadow-purple-500/25 flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
              </svg>
              Make a Copy
            </button>
          )}
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-purple-100 px-3 py-1.5 text-xs font-medium hover:bg-purple-50 hover:border-purple-200 transition-colors flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </a>
          )}
        </div>
      </header>

      {/* Main content: Chat + PDF */}
      <div className="flex-1 flex min-h-0">
        {/* Chat Panel (left) */}
        {isOwner && (
          <div className="w-[420px] border-r border-purple-100 flex flex-col shrink-0 bg-white">
            <ChatPanel
              projectId={project.id}
              initialMessages={initialMessages}
              onDone={handleChatDone}
            />
          </div>
        )}

        {/* PDF Canvas (right) */}
        <div className="flex-1 bg-gradient-to-br from-slate-50 to-purple-50/30">
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

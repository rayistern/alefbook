'use client'

import { useState, useCallback, useRef } from 'react'
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
  isLoggedIn = true,
}: {
  project: Project
  pdfUrl: string | null
  initialMessages: Message[]
  isOwner: boolean
  isLoggedIn?: boolean
}) {
  const [pdfUrl, setPdfUrl] = useState(initialPdfUrl)
  const [pdfKey, setPdfKey] = useState(0)
  const [compiling, setCompiling] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const texUploadRef = useRef<HTMLInputElement>(null)

  const refreshPdf = useCallback(async () => {
    try {
      const res = await fetch(`/api/project/${project.id}`)
      if (res.ok) {
        const data = await res.json()
        if (data.pdfUrl) {
          // Add cache-busting param so browser/CDN doesn't serve stale PDF
          const url = new URL(data.pdfUrl)
          url.searchParams.set('_t', Date.now().toString())
          setPdfUrl(url.toString())
          setPdfKey(k => k + 1)
        }
      }
    } catch (err) {
      console.warn('[ProjectEditor] PDF refresh failed:', err)
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
    if (!isLoggedIn) {
      window.location.href = `/auth/login?redirect=/view/${project.id}`
      return
    }
    const res = await fetch(`/api/project/${project.id}/fork`, { method: 'POST' })
    if (res.ok) {
      const fork = await res.json()
      window.location.href = `/project/${fork.id}`
    }
  }, [project.id, isLoggedIn])

  const handleDownloadTex = useCallback(async () => {
    const res = await fetch(`/api/project/${project.id}/tex`)
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'document.tex'
      a.click()
      URL.revokeObjectURL(url)
    }
  }, [project.id])

  const handleUploadTex = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // reset so same file can be re-selected

    const text = await file.text()
    if (!confirm(`Replace the current document with "${file.name}" (${text.length.toLocaleString()} chars)? This will overwrite your current LaTeX.`)) {
      return
    }

    const res = await fetch(`/api/project/${project.id}/tex`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: text,
    })

    if (res.ok) {
      const data = await res.json()
      if (data.warnings?.length) {
        alert(`LaTeX uploaded with warnings:\n${data.warnings.join('\n')}`)
      }
      // Recompile to generate new PDF
      handleCompile()
    } else {
      const data = await res.json().catch(() => ({ error: 'Upload failed' }))
      alert(data.error || 'Upload failed')
    }
  }, [project.id, handleCompile])

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="bg-white border-b px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/logo.png" alt="Shluchim Exchange" className="w-7 h-7 rounded-lg object-contain" />
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
              PDF
            </a>
          )}
          <button
            onClick={handleDownloadTex}
            className="rounded-lg border border-purple-100 px-3 py-1.5 text-xs font-medium hover:bg-purple-50 hover:border-purple-200 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            LaTeX
          </button>
          {isOwner && (
            <>
              <button
                onClick={() => texUploadRef.current?.click()}
                className="rounded-lg border border-purple-100 px-3 py-1.5 text-xs font-medium hover:bg-purple-50 hover:border-purple-200 transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4v12" />
                </svg>
                Upload LaTeX
              </button>
              <input
                ref={texUploadRef}
                type="file"
                accept=".tex,.latex,.txt"
                onChange={handleUploadTex}
                className="hidden"
              />
            </>
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

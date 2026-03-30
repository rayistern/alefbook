'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
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
  bleedPdfUrl: initialBleedPdfUrl,
  initialMessages,
  isOwner,
  isLoggedIn = true,
}: {
  project: Project
  pdfUrl: string | null
  bleedPdfUrl?: string | null
  initialMessages: Message[]
  isOwner: boolean
  isLoggedIn?: boolean
}) {
  const [pdfUrl, setPdfUrl] = useState(initialPdfUrl)
  const [bleedPdfUrl, setBleedPdfUrl] = useState(initialBleedPdfUrl ?? null)
  const [pdfKey, setPdfKey] = useState(0)
  const [compiling, setCompiling] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const texUploadRef = useRef<HTMLInputElement>(null)

  // Mobile responsive state
  const [isMobile, setIsMobile] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<'book' | 'chat'>('book')

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])


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
        if (data.bleedPdfUrl) {
          const bleedUrl = new URL(data.bleedPdfUrl)
          bleedUrl.searchParams.set('_t', Date.now().toString())
          setBleedPdfUrl(bleedUrl.toString())
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
        if (data.bleedPdfUrl) {
          setBleedPdfUrl(data.bleedPdfUrl)
        }
      }
    } finally {
      setCompiling(false)
    }
  }, [project.id])

  const handleChatDone = useCallback(() => {
    // Short delay to let Supabase storage flush the new PDF before fetching
    setTimeout(() => refreshPdf(), 1500)
  }, [refreshPdf])

  const [undoing, setUndoing] = useState(false)
  const handleUndo = useCallback(async () => {
    if (!confirm('Undo the last AI change and restore the previous version?')) return
    setUndoing(true)
    try {
      const res = await fetch(`/api/project/${project.id}/undo`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        if (data.pdfUrl) {
          const url = new URL(data.pdfUrl)
          url.searchParams.set('_t', Date.now().toString())
          setPdfUrl(url.toString())
          setPdfKey(k => k + 1)
        } else {
          setTimeout(() => refreshPdf(), 1500)
        }
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Undo failed')
      }
    } finally {
      setUndoing(false)
    }
  }, [project.id, refreshPdf])

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
      <header className="bg-white border-b px-2 md:px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 md:gap-3 shrink-0 min-w-0">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0">
            <img src="/logo.png" alt="Shluchim Exchange" className="w-7 h-7 rounded-lg object-contain" />
          </Link>
          <div className="w-px h-5 bg-purple-100 shrink-0" />
          <span className="text-sm font-medium truncate max-w-[120px] md:max-w-[200px]">{project.name}</span>
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
        <div className="flex items-center gap-1 md:gap-2 overflow-x-auto">
          {isOwner && (
            <>
              <button
                onClick={handleUndo}
                disabled={undoing || compiling}
                className="rounded-lg border border-amber-200 bg-amber-50 px-2 md:px-3 py-1.5 min-h-[44px] text-xs font-medium text-amber-700 hover:bg-amber-100 hover:border-amber-300 disabled:opacity-50 transition-colors whitespace-nowrap flex items-center gap-1.5 shrink-0"
                title="Undo last AI change"
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v2M3 10l4-4m-4 4l4 4" />
                </svg>
                <span className="hidden md:inline">{undoing ? 'Undoing...' : 'Undo'}</span>
              </button>
              <button
                onClick={handleCompile}
                disabled={compiling}
                className="rounded-lg border border-purple-100 px-2 md:px-3 py-1.5 min-h-[44px] text-xs font-medium hover:bg-purple-50 hover:border-purple-200 disabled:opacity-50 transition-colors whitespace-nowrap flex items-center gap-1.5 shrink-0"
                title="Regenerate PDF"
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="hidden md:inline">Regenerate PDF</span>
              </button>
              <button
                onClick={() => setShowShare(true)}
                className="rounded-lg border border-purple-100 px-2 md:px-3 py-1.5 min-h-[44px] text-xs font-medium hover:bg-purple-50 hover:border-purple-200 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                title="Share"
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                <span className="hidden md:inline">Share</span>
              </button>
            </>
          )}
          {!isOwner && (
            <button
              onClick={handleFork}
              className="rounded-lg gradient-bg px-2 md:px-4 py-1.5 min-h-[44px] text-xs font-medium text-white hover:opacity-90 transition-opacity shadow-sm shadow-purple-500/25 flex items-center gap-1.5 whitespace-nowrap shrink-0"
              title="Make a Copy"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
              </svg>
              <span className="hidden md:inline">Make a Copy</span>
            </button>
          )}
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-purple-100 px-2 md:px-3 py-1.5 min-h-[44px] text-xs font-medium hover:bg-purple-50 hover:border-purple-200 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
              title="Download PDF"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span className="hidden sm:inline">PDF</span>
            </a>
          )}
          {bleedPdfUrl && (
            <a
              href={bleedPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-purple-100 px-2 md:px-3 py-1.5 min-h-[44px] text-xs font-medium hover:bg-purple-50 hover:border-purple-200 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
              title="Download print-ready PDF with bleed &amp; crop marks"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              <span className="hidden sm:inline">Print PDF</span>
            </a>
          )}
          <button
            onClick={handleDownloadTex}
            className="rounded-lg border border-purple-100 px-2 md:px-3 py-1.5 min-h-[44px] text-xs font-medium hover:bg-purple-50 hover:border-purple-200 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            title="Download LaTeX"
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span className="hidden md:inline">LaTeX</span>
          </button>
          {isOwner && (
            <>
              <button
                onClick={() => texUploadRef.current?.click()}
                className="rounded-lg border border-purple-100 px-2 md:px-3 py-1.5 min-h-[44px] text-xs font-medium hover:bg-purple-50 hover:border-purple-200 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                title="Upload LaTeX"
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4v12" />
                </svg>
                <span className="hidden md:inline">Upload LaTeX</span>
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

      {project.page_count % 4 !== 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800 shrink-0 flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>
            This book has {project.page_count} pages, which is not a multiple of 4. Booklet printing typically requires a multiple of 4. You can ask the AI to add blank pages as needed.
          </span>
        </div>
      )}

      {/* Main content: Chat + PDF */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* PDF Canvas — on mobile: top panel; on desktop: right side */}
        <div
          className={`
            bg-gradient-to-br from-slate-50 to-purple-50/30 transition-all duration-300 overflow-hidden relative
            md:order-2 md:flex-1
            ${isMobile && isOwner
              ? mobilePanel === 'book'
                ? 'flex-[9] min-h-0'
                : 'flex-[1] cursor-pointer'
              : 'flex-1'
            }
          `}
          onClick={isMobile && isOwner && mobilePanel !== 'book' ? () => setMobilePanel('book') : undefined}
        >
          {/* Collapsed overlay label for mobile — sits on top of the still-rendered PDF */}
          {isMobile && isOwner && mobilePanel !== 'book' && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-sm font-medium text-purple-600 bg-gradient-to-br from-slate-50/90 to-purple-50/90">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              Tap to view PDF
            </div>
          )}
          <PdfViewer key={pdfKey} url={pdfUrl} />
        </div>

        {/* Chat Panel — on mobile: bottom panel; on desktop: left side */}
        {/* NEVER unmounted on mobile — just resized — so chat state & SSE connections persist */}
        {isOwner && (
          <div
            className={`
              border-purple-100 flex flex-col bg-white transition-all duration-300 overflow-hidden relative
              md:order-1 md:w-[420px] md:border-r md:shrink-0
              ${isMobile
                ? mobilePanel === 'chat'
                  ? 'flex-[9] min-h-0 border-t'
                  : 'flex-[1] cursor-pointer border-t'
                : ''
              }
            `}
            onClick={isMobile && mobilePanel !== 'chat' ? () => setMobilePanel('chat') : undefined}
          >
            {/* Collapsed overlay label for mobile — chat component stays mounted underneath */}
            {isMobile && mobilePanel !== 'chat' && (
              <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-sm font-medium text-purple-600 bg-white/90">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Tap to chat with AI
              </div>
            )}
            <ChatPanel
              projectId={project.id}
              initialMessages={initialMessages}
              onDone={handleChatDone}
              onFocus={() => { if (isMobile) setMobilePanel('chat') }}
            />
          </div>
        )}
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

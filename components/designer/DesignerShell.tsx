'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'
import { ChatPanel, type ChatMessage } from './ChatPanel'
import { PageViewer } from './PageViewer'
import { Sidebar } from './Sidebar'
import { Button } from '@/components/ui/button'
import {
  ArrowLeft,
  ShoppingCart,
  Check,
} from 'lucide-react'

interface PageMeta {
  page_number: number
  label: string
  section: string
  is_fixed_liturgy: boolean
  content_summary: string
  has_image_slots: boolean
  editable: boolean
}

interface UploadedImage {
  id: string
  filename: string
  displayUrl: string
}

interface DesignerShellProps {
  projectId: string
  projectName: string
  totalPages: number
  pages: PageMeta[]
  initialMessages: ChatMessage[]
  initialUploads: UploadedImage[]
  initialRenderUrls: Record<number, string>
  initialEditedPages: number[]
  shopifyVariantId?: string
  shopifyStoreUrl?: string
}

export function DesignerShell({
  projectId,
  projectName,
  totalPages,
  pages,
  initialMessages,
  initialUploads,
  initialRenderUrls,
  initialEditedPages,
  shopifyVariantId,
  shopifyStoreUrl,
}: DesignerShellProps) {
  const router = useRouter()
  const [currentPage, setCurrentPage] = useState(1)
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [uploads, setUploads] = useState<UploadedImage[]>(initialUploads)
  const [renderUrls, setRenderUrls] = useState<Record<number, string>>(initialRenderUrls)
  const [editedPages, setEditedPages] = useState<Set<number>>(new Set(initialEditedPages))
  const [isWorking, setIsWorking] = useState(false)
  const [passInfo, setPassInfo] = useState<{ current: number; total: number } | null>(null)
  const [uploading, setUploading] = useState(false)
  // mobileView state removed — mobile now shows book + chat in a single pane
  const [title, setTitle] = useState(projectName)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const saveTitleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Render current page on mount / page change if no cached render
  useEffect(() => {
    if (!renderUrls[currentPage]) {
      renderPage(currentPage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage])

  // Focus title input when editing starts
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [isEditingTitle])

  async function renderPage(pageNum: number) {
    try {
      console.log(`[Render] Rendering page ${pageNum} for project ${projectId}`)
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, pageNumbers: [pageNum] }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        console.error(`[Render] Failed for page ${pageNum}:`, res.status, err)
        return
      }
      const data = await res.json()
      console.log(`[Render] Page ${pageNum} rendered, URLs:`, Object.keys(data.renderUrls || {}))
      setRenderUrls(prev => ({ ...prev, ...data.renderUrls }))
    } catch (error) {
      console.error('[Render] Exception for page:', pageNum, error)
    }
  }

  async function saveTitle(newTitle: string) {
    setSaveStatus('saving')
    try {
      const res = await fetch('/api/project', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: projectId, name: newTitle }),
      })
      if (res.ok) {
        setSaveStatus('saved')
      } else {
        setSaveStatus('unsaved')
      }
    } catch {
      setSaveStatus('unsaved')
    }
  }

  function handleTitleChange(newTitle: string) {
    setTitle(newTitle)
    setSaveStatus('unsaved')
    if (saveTitleTimeoutRef.current) {
      clearTimeout(saveTitleTimeoutRef.current)
    }
    saveTitleTimeoutRef.current = setTimeout(() => {
      saveTitle(newTitle)
    }, 1000)
  }

  function handleTitleBlur() {
    setIsEditingTitle(false)
    const trimmed = title.trim()
    if (!trimmed) {
      setTitle(projectName)
      return
    }
    if (trimmed !== projectName) {
      if (saveTitleTimeoutRef.current) {
        clearTimeout(saveTitleTimeoutRef.current)
      }
      saveTitle(trimmed)
    }
  }

  function handleTitleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleTitleBlur()
    }
    if (e.key === 'Escape') {
      setTitle(projectName)
      setIsEditingTitle(false)
    }
  }

  const handleSendMessage = useCallback(
    async (message: string) => {
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
      }
      setMessages(prev => [...prev, userMsg])
      setIsWorking(true)
      setPassInfo({ current: 1, total: 5 })
      setSaveStatus('saving')

      try {
        console.log('[Chat] Sending message:', { message, projectId, currentPage })
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            projectId,
            currentPage,
          }),
        })

        if (!res.ok) {
          const error = await res.json().catch(() => ({ error: 'Request failed' }))
          console.error('[Chat] API error:', res.status, error)
          const errMsg: ChatMessage = {
            id: `err-${Date.now()}`,
            role: 'assistant',
            content: error.error || 'Something went wrong. Please try again.',
            createdAt: new Date().toISOString(),
          }
          setMessages(prev => [...prev, errMsg])
          return
        }

        const data = await res.json()
        console.log('[Chat] Response received:', {
          responseText: data.responseText?.substring(0, 200),
          updatedPages: data.updatedPages,
          passCount: data.passCount,
          reviewPassed: data.reviewPassed,
          unresolvedIssues: data.unresolvedIssues,
          renderUrlKeys: data.renderUrls ? Object.keys(data.renderUrls) : [],
        })

        // Build response: main text + unresolved issues as a separate note
        let fullResponse = data.responseText || ''
        if (data.unresolvedIssues?.length > 0) {
          fullResponse += `\n\nSome issues remain: ${data.unresolvedIssues.join('; ')}. You can ask me to try again.`
        }

        const assistantMsg: ChatMessage = {
          id: `asst-${Date.now()}`,
          role: 'assistant',
          content: fullResponse,
          createdAt: new Date().toISOString(),
        }
        setMessages(prev => [...prev, assistantMsg])

        // Update renders
        if (data.renderUrls) {
          setRenderUrls(prev => ({ ...prev, ...data.renderUrls }))
        }

        // Mark pages as edited
        if (data.updatedPages) {
          setEditedPages(prev => {
            const next = new Set(prev)
            data.updatedPages.forEach((p: number) => next.add(p))
            return next
          })
        }

        setPassInfo({
          current: data.passCount ?? 1,
          total: 5,
        })
      } catch (error) {
        console.error('[Chat] Exception:', error)
        const errMsg: ChatMessage = {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: 'Something went wrong. Please try again.',
          createdAt: new Date().toISOString(),
        }
        setMessages(prev => [...prev, errMsg])
      } finally {
        setIsWorking(false)
        setPassInfo(null)
        setSaveStatus('saved')
      }
    },
    [projectId, currentPage]
  )

  const handleEditMessage = useCallback(
    (messageId: string, newContent: string) => {
      if (isWorking) return
      // Remove the edited message and everything after it
      setMessages(prev => {
        const idx = prev.findIndex(m => m.id === messageId)
        if (idx === -1) return prev
        return prev.slice(0, idx)
      })
      // Resend with new content
      handleSendMessage(newContent)
    },
    [isWorking, handleSendMessage]
  )

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true)
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('projectId', projectId)

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        })

        if (res.ok) {
          const upload = await res.json()
          setUploads(prev => [
            ...prev,
            {
              id: upload.id,
              filename: upload.filename,
              displayUrl: upload.displayUrl,
            },
          ])
        }
      } catch (error) {
        console.error('Upload failed:', error)
      } finally {
        setUploading(false)
      }
    },
    [projectId]
  )

  const handlePhotoClick = useCallback(
    (filename: string) => {
      handleSendMessage(
        `Please place ${filename} on the current page in the most appropriate image slot`
      )
    },
    [handleSendMessage]
  )

  const handlePreviewPdf = useCallback(async () => {
    try {
      console.log('[PDF Preview] Starting PDF generation for project:', projectId)
      const res = await fetch('/api/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: res.statusText }))
        console.error('[PDF Preview] API error:', res.status, errBody)
        return
      }
      const data = await res.json()
      console.log('[PDF Preview] PDF generated, downloading from:', data.pdfUrl)

      // Download as file instead of opening in new tab (avoids popup blockers)
      const link = document.createElement('a')
      link.href = data.pdfUrl
      link.download = `${title || 'haggadah'}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (error) {
      console.error('[PDF Preview] Failed:', error)
    }
  }, [projectId, title])

  const handleOrderPrint = useCallback(async () => {
    if (!shopifyStoreUrl || !shopifyVariantId) return

    try {
      const res = await fetch('/api/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      if (res.ok) {
        const data = await res.json()
        const checkoutUrl = `${shopifyStoreUrl}/cart/add?id=${shopifyVariantId}&properties[pdf_url]=${encodeURIComponent(data.pdfUrl)}&properties[project_id]=${projectId}`
        window.location.href = checkoutUrl
      }
    } catch (error) {
      console.error('Order failed:', error)
    }
  }, [projectId, shopifyStoreUrl, shopifyVariantId])

  // Prevent page navigation while working
  const handlePageChange = useCallback(
    (page: number) => {
      if (isWorking) return
      setCurrentPage(page)
    },
    [isWorking]
  )

  // Get current page metadata
  const currentPageMeta = pages.find(p => p.page_number === currentPage)
  const isCurrentPageEditable = currentPageMeta?.editable !== false

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex h-14 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </div>

        {/* Center: editable title + save indicator */}
        <div className="flex items-center gap-2">
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              value={title}
              onChange={e => handleTitleChange(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={handleTitleKeyDown}
              className="rounded border-none bg-transparent px-2 py-1 text-center text-sm font-semibold outline-none ring-1 ring-ring"
              style={{ minWidth: 120, maxWidth: 300 }}
            />
          ) : (
            <button
              onClick={() => setIsEditingTitle(true)}
              className="rounded px-2 py-1 text-sm font-semibold transition-colors hover:bg-accent"
              title="Click to rename"
            >
              {title}
            </button>
          )}
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {saveStatus === 'saved' && (
              <>
                <Check className="h-3 w-3" />
                Saved
              </>
            )}
            {saveStatus === 'saving' && 'Saving...'}
            {saveStatus === 'unsaved' && 'Unsaved'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {shopifyVariantId && (
            <Button size="sm" onClick={handleOrderPrint}>
              <ShoppingCart className="mr-2 h-4 w-4" />
              Order Print
            </Button>
          )}
          <UserButton />
        </div>
      </header>

      {/* Desktop 3-panel layout: chat 360px, sidebar 320px */}
      <div className="hidden flex-1 overflow-hidden md:grid md:grid-cols-[360px_1fr_320px] md:[grid-template-rows:minmax(0,1fr)]">
        <ChatPanel
          messages={messages}
          onSend={handleSendMessage}
          onEditMessage={handleEditMessage}
          isWorking={isWorking}
          passInfo={passInfo}
        />
        <PageViewer
          projectId={projectId}
          currentPage={currentPage}
          totalPages={totalPages}
          renderUrl={renderUrls[currentPage] ?? null}
          isWorking={isWorking}
          isEditable={isCurrentPageEditable}
          pageLabel={currentPageMeta?.label ?? `Page ${currentPage}`}
          passInfo={passInfo}
          onPageChange={handlePageChange}
          onPreviewPdf={handlePreviewPdf}
        />
        <Sidebar
          projectId={projectId}
          uploads={uploads}
          pages={pages}
          currentPage={currentPage}
          editedPages={editedPages}
          renderUrls={renderUrls}
          onUpload={handleUpload}
          onPhotoClick={handlePhotoClick}
          onPageSelect={handlePageChange}
          uploading={uploading}
          isWorking={isWorking}
        />
      </div>

      {/*
        Mobile layout (below md breakpoint):
        - Single pane: book image + chat (no tabs, no sidebar/photo reservoir)
        - Portrait: book on top (40%), chat on bottom (60%)
        - Landscape: side-by-side split (book left, chat right)
        - Images are uploaded as chat attachments via the paperclip button
      */}
      <div className="flex flex-1 flex-col landscape:flex-row overflow-hidden md:hidden">
        {/* Book page viewer */}
        <div className="h-[40%] min-h-0 shrink-0 overflow-auto border-b landscape:h-full landscape:w-1/2 landscape:border-b-0 landscape:border-r">
          <PageViewer
            projectId={projectId}
            currentPage={currentPage}
            totalPages={totalPages}
            renderUrl={renderUrls[currentPage] ?? null}
            isWorking={isWorking}
            passInfo={passInfo}
            onPageChange={handlePageChange}
            onPreviewPdf={handlePreviewPdf}
            compact
          />
        </div>
        {/* Chat panel */}
        <div className="flex-1 min-h-0 overflow-hidden landscape:w-1/2">
          <ChatPanel
            messages={messages}
            onSend={handleSendMessage}
            onEditMessage={handleEditMessage}
            isWorking={isWorking}
            passInfo={passInfo}
            onUpload={handleUpload}
            uploading={uploading}
          />
        </div>
      </div>
    </div>
  )
}

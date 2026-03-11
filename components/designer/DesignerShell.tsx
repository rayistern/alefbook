'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { UserButton } from '@clerk/nextjs'
import { ChatPanel, type ChatMessage } from './ChatPanel'
import { PageViewer } from './PageViewer'
import { Sidebar } from './Sidebar'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  MessageSquare,
  BookOpen,
  ImageIcon,
  ArrowLeft,
  ShoppingCart,
} from 'lucide-react'

interface PageMeta {
  page_number: number
  label: string
  section: string
  is_fixed_liturgy: boolean
  content_summary: string
  has_image_slots: boolean
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
  const [mobileView, setMobileView] = useState<'chat' | 'page' | 'photos'>('chat')

  useEffect(() => {
    if (!renderUrls[currentPage]) {
      renderPage(currentPage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage])

  async function renderPage(pageNum: number) {
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, pageNumbers: [pageNum] }),
      })
      if (res.ok) {
        const data = await res.json()
        setRenderUrls(prev => ({ ...prev, ...data.renderUrls }))
      }
    } catch (error) {
      console.error('Failed to render page:', error)
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

      try {
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

        const assistantMsg: ChatMessage = {
          id: `asst-${Date.now()}`,
          role: 'assistant',
          content: data.responseText,
          createdAt: new Date().toISOString(),
        }
        setMessages(prev => [...prev, assistantMsg])

        if (data.renderUrls) {
          setRenderUrls(prev => ({ ...prev, ...data.renderUrls }))
        }

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
        console.error('Chat error:', error)
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
      }
    },
    [projectId, currentPage]
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
              displayUrl: upload.storage_path_display,
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
      const res = await fetch('/api/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      if (res.ok) {
        const data = await res.json()
        window.open(data.pdfUrl, '_blank')
      }
    } catch (error) {
      console.error('PDF preview failed:', error)
    }
  }, [projectId])

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

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex h-14 items-center justify-between border-b border-border/50 bg-card px-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Image
            src="/images/LOGO11B-2X1.png"
            alt="AlefBook"
            width={100}
            height={50}
            className="hidden h-7 w-auto sm:block"
          />
          <span className="text-sm font-medium text-muted-foreground">/</span>
          <h1 className="text-sm font-semibold">{projectName}</h1>
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

      {/* Desktop 3-panel layout */}
      <div className="hidden flex-1 overflow-hidden md:grid md:grid-cols-[320px_1fr_280px]">
        <ChatPanel
          messages={messages}
          onSend={handleSendMessage}
          isWorking={isWorking}
          passInfo={passInfo}
        />
        <PageViewer
          currentPage={currentPage}
          totalPages={totalPages}
          renderUrl={renderUrls[currentPage] ?? null}
          isWorking={isWorking}
          passInfo={passInfo}
          onPageChange={setCurrentPage}
          onPreviewPdf={handlePreviewPdf}
        />
        <Sidebar
          uploads={uploads}
          pages={pages}
          currentPage={currentPage}
          editedPages={editedPages}
          renderUrls={renderUrls}
          onUpload={handleUpload}
          onPhotoClick={handlePhotoClick}
          onPageSelect={setCurrentPage}
          uploading={uploading}
        />
      </div>

      {/* Mobile layout */}
      <div className="flex flex-1 flex-col overflow-hidden md:hidden">
        {mobileView === 'chat' && (
          <div className="flex-1 overflow-hidden">
            <ChatPanel
              messages={messages}
              onSend={handleSendMessage}
              isWorking={isWorking}
              passInfo={passInfo}
            />
          </div>
        )}
        {mobileView === 'page' && (
          <div className="flex-1 overflow-auto">
            <PageViewer
              currentPage={currentPage}
              totalPages={totalPages}
              renderUrl={renderUrls[currentPage] ?? null}
              isWorking={isWorking}
              passInfo={passInfo}
              onPageChange={setCurrentPage}
              onPreviewPdf={handlePreviewPdf}
            />
          </div>
        )}
        {mobileView === 'photos' && (
          <Sheet>
            <SheetTrigger asChild>
              <div />
            </SheetTrigger>
            <SheetContent className="bg-card">
              <SheetTitle>Photos & Pages</SheetTitle>
              <Sidebar
                uploads={uploads}
                pages={pages}
                currentPage={currentPage}
                editedPages={editedPages}
                renderUrls={renderUrls}
                onUpload={handleUpload}
                onPhotoClick={handlePhotoClick}
                onPageSelect={setCurrentPage}
                uploading={uploading}
              />
            </SheetContent>
          </Sheet>
        )}

        {/* Mobile bottom navigation */}
        <nav className="flex border-t border-border/50 bg-card">
          <button
            onClick={() => setMobileView('chat')}
            className={`flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors ${
              mobileView === 'chat' ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <MessageSquare className="h-5 w-5" />
            Chat
          </button>
          <button
            onClick={() => setMobileView('page')}
            className={`flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors ${
              mobileView === 'page' ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <BookOpen className="h-5 w-5" />
            Page
          </button>
          <button
            onClick={() => setMobileView('photos')}
            className={`flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors ${
              mobileView === 'photos' ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <ImageIcon className="h-5 w-5" />
            Photos
          </button>
        </nav>
      </div>
    </div>
  )
}

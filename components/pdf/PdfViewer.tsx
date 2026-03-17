'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/esm/Page/AnnotationLayer.css'
import 'react-pdf/dist/esm/Page/TextLayer.css'

// Set up worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

export function PdfViewer({ url }: { url: string | null }) {
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1.0)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages)
    setCurrentPage(1)
    setError(null)
  }, [])

  const onDocumentLoadError = useCallback((error: Error) => {
    setError(error.message)
  }, [])

  // Track which page is currently visible via scroll position
  useEffect(() => {
    const container = containerRef.current
    if (!container || numPages === 0) return

    const handleScroll = () => {
      const containerRect = container.getBoundingClientRect()
      const containerMid = containerRect.top + containerRect.height / 2

      let closestPage = 1
      let closestDist = Infinity

      pageRefs.current.forEach((el, pageNum) => {
        const rect = el.getBoundingClientRect()
        const pageMid = rect.top + rect.height / 2
        const dist = Math.abs(pageMid - containerMid)
        if (dist < closestDist) {
          closestDist = dist
          closestPage = pageNum
        }
      })

      setCurrentPage(closestPage)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [numPages])

  const setPageRef = useCallback((pageNum: number, el: HTMLDivElement | null) => {
    if (el) {
      pageRefs.current.set(pageNum, el)
    } else {
      pageRefs.current.delete(pageNum)
    }
  }, [])

  if (!url) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl gradient-bg-subtle flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <p className="font-medium text-sm">No preview yet</p>
          <p className="text-xs mt-1 max-w-[200px] mx-auto">
            Start chatting with the AI to create your book, then it will appear here.
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-destructive text-sm">
        <div className="text-center">
          <p className="font-medium">Could not load preview</p>
          <p className="text-xs mt-1 text-muted-foreground">Try regenerating the PDF</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Controls */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-white/80 backdrop-blur-sm">
        <span className="text-xs text-muted-foreground min-w-[60px]">
          {numPages > 0 ? `${currentPage} of ${numPages}` : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
            className="rounded-lg p-1.5 hover:bg-purple-50 transition-colors"
            title="Zoom out"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
            </svg>
          </button>
          <span className="text-xs text-muted-foreground min-w-[40px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => setScale(s => Math.min(3, s + 0.25))}
            className="rounded-lg p-1.5 hover:bg-purple-50 transition-colors"
            title="Zoom in"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={() => setScale(1.0)}
            className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-purple-50 hover:text-purple-600 transition-colors ml-1"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Scrollable PDF canvas — all pages rendered continuously */}
      <div ref={containerRef} className="flex-1 overflow-auto">
        <div className="flex flex-col items-center py-6 gap-4">
          <Document
            file={url}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-20">
                <svg className="animate-spin w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Loading preview...
              </div>
            }
          >
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
              <div
                key={pageNum}
                ref={(el) => setPageRef(pageNum, el)}
                className="mb-2"
              >
                <Page
                  pageNumber={pageNum}
                  scale={scale}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                  className="shadow-xl rounded-sm"
                />
              </div>
            ))}
          </Document>
        </div>
      </div>
    </div>
  )
}

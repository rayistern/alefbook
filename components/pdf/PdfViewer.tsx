'use client'

import { useState, useCallback } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/esm/Page/AnnotationLayer.css'
import 'react-pdf/dist/esm/Page/TextLayer.css'

// Set up worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

export function PdfViewer({ url }: { url: string | null }) {
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.0)
  const [error, setError] = useState<string | null>(null)

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages)
    setCurrentPage(1)
    setError(null)
  }, [])

  const onDocumentLoadError = useCallback((error: Error) => {
    setError(error.message)
  }, [])

  if (!url) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <p className="font-medium">No PDF yet</p>
          <p className="mt-1">Send a message to start editing, then compile to see the PDF.</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-destructive text-sm">
        <p>Failed to load PDF: {error}</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Controls */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-background">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="rounded border px-2 py-1 text-xs disabled:opacity-30"
          >
            Prev
          </button>
          <span className="text-xs text-muted-foreground">
            {currentPage} / {numPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
            disabled={currentPage >= numPages}
            className="rounded border px-2 py-1 text-xs disabled:opacity-30"
          >
            Next
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
            className="rounded border px-2 py-1 text-xs"
          >
            -
          </button>
          <span className="text-xs text-muted-foreground">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale(s => Math.min(3, s + 0.25))}
            className="rounded border px-2 py-1 text-xs"
          >
            +
          </button>
          <button
            onClick={() => setScale(1.0)}
            className="rounded border px-2 py-1 text-xs"
          >
            Fit
          </button>
        </div>
      </div>

      {/* PDF */}
      <div className="flex-1 overflow-auto flex justify-center p-4">
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={
            <div className="text-sm text-muted-foreground">Loading PDF...</div>
          }
        >
          <Page
            pageNumber={currentPage}
            scale={scale}
            renderTextLayer={true}
            renderAnnotationLayer={true}
          />
        </Document>
      </div>

      {/* Page thumbnail strip */}
      {numPages > 1 && (
        <div className="border-t bg-background px-4 py-2 overflow-x-auto">
          <div className="flex gap-2">
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
              <button
                key={pageNum}
                onClick={() => setCurrentPage(pageNum)}
                className={`shrink-0 w-12 h-16 rounded border text-xs flex items-center justify-center transition-colors ${
                  pageNum === currentPage
                    ? 'border-primary bg-primary/10 font-medium'
                    : 'hover:border-primary/30'
                }`}
              >
                {pageNum}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

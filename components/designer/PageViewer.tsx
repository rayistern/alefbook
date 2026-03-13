'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, FileDown, Loader2, Lock } from 'lucide-react'

interface PageViewerProps {
  projectId: string
  currentPage: number
  totalPages: number
  renderUrl: string | null
  isWorking: boolean
  isEditable: boolean
  pageLabel: string
  passInfo?: { current: number; total: number } | null
  projectFormat?: 'html' | 'latex'
  onPageChange: (page: number) => void
  onPreviewPdf: () => Promise<void> | void
  compact?: boolean
}

export function PageViewer({
  projectId,
  currentPage,
  totalPages,
  renderUrl,
  isWorking,
  isEditable,
  pageLabel,
  passInfo,
  projectFormat = 'html',
  onPageChange,
  onPreviewPdf,
  compact,
}: PageViewerProps) {
  const [pdfLoading, setPdfLoading] = useState(false)
  const iframeSrc = `/api/page-html?projectId=${projectId}&page=${currentPage}`

  const designingLabel = passInfo
    ? passInfo.current <= 1
      ? 'Designing...'
      : `Designing... (pass ${passInfo.current}/${passInfo.total})`
    : 'Designing...'

  async function handlePreviewPdf() {
    setPdfLoading(true)
    try {
      await onPreviewPdf()
    } finally {
      setPdfLoading(false)
    }
  }

  return (
    <div className={`flex flex-1 flex-col items-center justify-center ${compact ? 'gap-2 p-2' : 'gap-4 p-4'}`}>
      {/* Non-editable page warning */}
      {!isEditable && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <Lock className="h-4 w-4 flex-shrink-0" />
          <span>
            <strong>{pageLabel}</strong> is not editable. This page is locked and cannot be modified.
          </span>
        </div>
      )}

      <div className="relative">
        {/* Page render display */}
        <div
          className={`relative overflow-hidden rounded-lg border bg-white shadow-md ${
            compact ? 'aspect-square w-full max-w-[280px]' : ''
          }`}
          style={compact ? undefined : { width: 540, height: 540, minWidth: 320, minHeight: 320 }}
        >
          {renderUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={renderUrl}
                alt={`Page ${currentPage}`}
                className={`h-full w-full object-contain transition-opacity duration-300 ${
                  isWorking ? 'opacity-50' : 'opacity-100'
                }`}
                {...(compact ? {} : { width: 540, height: 540, style: { minWidth: 320, minHeight: 320 } })}
              />
              {isWorking && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="rounded-lg bg-black/60 px-4 py-2 text-sm text-white">
                    {designingLabel}
                  </div>
                  {/* Shimmer overlay */}
                  <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                </div>
              )}
            </>
          ) : projectFormat === 'latex' ? (
            <div className="flex h-full w-full items-center justify-center bg-gray-50">
              <div className="text-center text-sm text-muted-foreground">
                <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
                Rendering page...
              </div>
            </div>
          ) : (
            <iframe
              key={`page-${currentPage}`}
              src={iframeSrc}
              title={`Page ${currentPage}`}
              className={`h-full w-full border-0 transition-opacity duration-300 ${
                isWorking ? 'opacity-50' : 'opacity-100'
              }`}
              sandbox="allow-same-origin"
              style={{ pointerEvents: 'none' }}
            />
          )}
          {isWorking && !renderUrl && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-lg bg-black/60 px-4 py-2 text-sm text-white">
                {designingLabel}
              </div>
            </div>
          )}

          {/* Lock overlay for non-editable pages */}
          {!isEditable && !isWorking && (
            <div className="absolute bottom-2 right-2">
              <div className="rounded-full bg-amber-100 p-1.5 shadow-sm">
                <Lock className="h-4 w-4 text-amber-700" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="icon"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1 || isWorking}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground">
          page {currentPage} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="icon"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages || isWorking}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* PDF Preview button - hidden in compact mode */}
      {!compact && (
        <Button variant="outline" onClick={handlePreviewPdf} disabled={pdfLoading}>
          {pdfLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileDown className="mr-2 h-4 w-4" />
          )}
          {pdfLoading ? 'Generating PDF...' : 'Preview PDF'}
        </Button>
      )}
    </div>
  )
}

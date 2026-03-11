'use client'

import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, FileDown } from 'lucide-react'

interface PageViewerProps {
  currentPage: number
  totalPages: number
  renderUrl: string | null
  isWorking: boolean
  passInfo?: { current: number; total: number } | null
  onPageChange: (page: number) => void
  onPreviewPdf: () => void
}

export function PageViewer({
  currentPage,
  totalPages,
  renderUrl,
  isWorking,
  passInfo,
  onPageChange,
  onPreviewPdf,
}: PageViewerProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
      <div className="relative">
        {/* Page render display */}
        <div
          className="relative overflow-hidden rounded-lg border bg-white shadow-md"
          style={{ width: 540, height: 540 }}
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
                width={540}
                height={540}
              />
              {isWorking && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="rounded-lg bg-black/60 px-4 py-2 text-sm text-white">
                    Designing...
                    {passInfo && ` (pass ${passInfo.current}/${passInfo.total})`}
                  </div>
                  {/* Shimmer overlay */}
                  <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              Loading page...
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
          disabled={currentPage <= 1}
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
          disabled={currentPage >= totalPages}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* PDF Preview button */}
      <Button variant="outline" onClick={onPreviewPdf}>
        <FileDown className="mr-2 h-4 w-4" />
        Preview PDF
      </Button>
    </div>
  )
}

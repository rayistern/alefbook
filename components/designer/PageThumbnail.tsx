'use client'

import { cn } from '@/lib/utils'

interface PageThumbnailProps {
  pageNumber: number
  label: string
  thumbnailUrl: string | null
  isActive: boolean
  isEdited: boolean
  onClick: () => void
}

export function PageThumbnail({
  pageNumber,
  label,
  thumbnailUrl,
  isActive,
  isEdited,
  onClick,
}: PageThumbnailProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-center gap-1 rounded p-1 transition-colors hover:bg-accent',
        isActive && 'ring-2 ring-primary'
      )}
      title={`${label} (page ${pageNumber})`}
    >
      <div className="relative h-[60px] w-[60px] overflow-hidden rounded border bg-white">
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt={`Page ${pageNumber}`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            {pageNumber}
          </div>
        )}
        {isEdited && (
          <div className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-green-500" />
        )}
      </div>
      <span className="max-w-[60px] truncate text-[10px] text-muted-foreground">
        {pageNumber}
      </span>
    </button>
  )
}

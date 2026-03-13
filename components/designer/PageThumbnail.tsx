'use client'

import { cn } from '@/lib/utils'
import { Lock } from 'lucide-react'

interface PageThumbnailProps {
  pageNumber: number
  label: string
  thumbnailUrl: string | null
  isActive: boolean
  isEdited: boolean
  isEditable: boolean
  onClick: () => void
  disabled?: boolean
}

export function PageThumbnail({
  pageNumber,
  label,
  thumbnailUrl,
  isActive,
  isEdited,
  isEditable,
  onClick,
  disabled = false,
}: PageThumbnailProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'relative flex flex-col items-center gap-1 rounded p-1 transition-colors hover:bg-accent',
        isActive && 'ring-2 ring-primary',
        disabled && 'cursor-not-allowed opacity-50'
      )}
      title={`${label} (page ${pageNumber})${!isEditable ? ' - Locked' : ''}`}
    >
      <div className="relative h-[60px] w-[60px] overflow-hidden rounded border bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbnailUrl || `/thumbnails/page-${String(pageNumber).padStart(3, '0')}.png`}
          alt={`Page ${pageNumber}`}
          className="h-full w-full object-cover"
          loading="lazy"
        />
        {isEdited && (
          <div className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-green-500" />
        )}
        {!isEditable && (
          <div className="absolute left-0.5 top-0.5 rounded-full bg-amber-100 p-0.5">
            <Lock className="h-2 w-2 text-amber-700" />
          </div>
        )}
      </div>
      <span className="max-w-[60px] truncate text-[10px] text-muted-foreground">
        {pageNumber}
      </span>
    </button>
  )
}

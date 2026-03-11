'use client'

import { useRef, useCallback } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Upload, ImageIcon } from 'lucide-react'
import { PageThumbnail } from './PageThumbnail'

interface UploadedImage {
  id: string
  filename: string
  displayUrl: string
}

interface PageInfo {
  page_number: number
  label: string
}

interface SidebarProps {
  projectId: string
  uploads: UploadedImage[]
  pages: PageInfo[]
  currentPage: number
  editedPages: Set<number>
  renderUrls: Record<number, string>
  onUpload: (file: File) => void
  onPhotoClick: (filename: string) => void
  onPageSelect: (page: number) => void
  uploading: boolean
}

export function Sidebar({
  projectId,
  uploads,
  pages,
  currentPage,
  editedPages,
  renderUrls,
  onUpload,
  onPhotoClick,
  onPageSelect,
  uploading,
}: SidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        onUpload(file)
        e.target.value = ''
      }
    },
    [onUpload]
  )

  return (
    <div className="flex h-full w-[280px] flex-col border-l">
      {/* My Photos section */}
      <div className="border-b px-4 py-3">
        <h3 className="font-semibold">My Photos</h3>
      </div>

      <div className="p-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif"
          onChange={handleFileChange}
          className="hidden"
        />
        <Button
          variant="outline"
          className="w-full"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="mr-2 h-4 w-4" />
          {uploading ? 'Uploading...' : 'Upload Photo'}
        </Button>

        {uploads.length > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {uploads.map(upload => (
              <button
                key={upload.id}
                onClick={() => onPhotoClick(upload.filename)}
                className="group relative aspect-square overflow-hidden rounded border transition-colors hover:ring-2 hover:ring-primary"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={upload.displayUrl}
                  alt={upload.filename}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
                  <ImageIcon className="h-5 w-5 text-white opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            No photos uploaded yet
          </p>
        )}
      </div>

      <Separator />

      {/* All Pages section */}
      <div className="border-b px-4 py-3">
        <h3 className="font-semibold">All Pages</h3>
      </div>

      <ScrollArea className="flex-1 p-3">
        <div className="grid grid-cols-4 gap-1">
          {pages.map(page => (
            <PageThumbnail
              key={page.page_number}
              projectId={projectId}
              pageNumber={page.page_number}
              label={page.label}
              thumbnailUrl={renderUrls[page.page_number] ?? null}
              isActive={page.page_number === currentPage}
              isEdited={editedPages.has(page.page_number)}
              onClick={() => onPageSelect(page.page_number)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

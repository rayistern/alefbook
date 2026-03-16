'use client'

import { useState } from 'react'

export function ShareDialog({
  projectId,
  isPublic: initialIsPublic,
  onClose,
}: {
  projectId: string
  isPublic: boolean
  onClose: () => void
}) {
  const [isPublic, setIsPublic] = useState(initialIsPublic)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  async function togglePublic() {
    setSaving(true)
    const res = await fetch(`/api/project/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_public: !isPublic }),
    })

    if (res.ok) {
      setIsPublic(!isPublic)
    }
    setSaving(false)
  }

  function copyLink() {
    const url = `${window.location.origin}/view/${projectId}`
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-background rounded-lg p-6 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg">Share Book</h3>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Public</p>
            <p className="text-xs text-muted-foreground">Anyone can view and fork</p>
          </div>
          <button
            onClick={togglePublic}
            disabled={saving}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              isPublic ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                isPublic ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        {isPublic && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Share link:</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={`${typeof window !== 'undefined' ? window.location.origin : ''}/view/${projectId}`}
                className="flex-1 rounded-md border border-input bg-muted px-2 py-1 text-xs"
              />
              <button
                onClick={copyLink}
                className="rounded-md border px-3 py-1 text-xs hover:bg-accent"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full rounded-md border px-3 py-2 text-sm hover:bg-accent"
        >
          Close
        </button>
      </div>
    </div>
  )
}

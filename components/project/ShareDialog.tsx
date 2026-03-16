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
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-5 shadow-2xl shadow-purple-500/10 border border-purple-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="font-semibold text-lg">Share Book</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Control who can see your creation</p>
        </div>

        <div className="flex items-center justify-between p-4 rounded-xl bg-purple-50/50 border border-purple-100">
          <div>
            <p className="text-sm font-medium">Make public</p>
            <p className="text-xs text-muted-foreground mt-0.5">Anyone can view and copy</p>
          </div>
          <button
            onClick={togglePublic}
            disabled={saving}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              isPublic ? 'gradient-bg' : 'bg-gray-200'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                isPublic ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        {isPublic && (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Share link</label>
            <div className="flex gap-2 mt-1.5">
              <input
                readOnly
                value={`${typeof window !== 'undefined' ? window.location.origin : ''}/view/${projectId}`}
                className="flex-1 rounded-xl border border-purple-100 bg-purple-50/30 px-3 py-2 text-xs focus:outline-none"
              />
              <button
                onClick={copyLink}
                className={`rounded-xl px-4 py-2 text-xs font-medium transition-all ${
                  copied
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'gradient-bg text-white hover:opacity-90 shadow-sm shadow-purple-500/20'
                }`}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full rounded-xl border border-purple-100 px-4 py-2.5 text-sm font-medium hover:bg-purple-50 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  )
}

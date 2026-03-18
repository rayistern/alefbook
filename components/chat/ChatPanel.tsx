'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface Message {
  id: string
  role: string
  content: string
  metadata?: unknown
  created_at: string
}

interface TaskEvent {
  type: string
  message?: string
  error?: string
}

interface StepInfo {
  label: string
  status: 'active' | 'done'
}

const MODELS = [
  { id: 'openai/gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
  { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'openai/gpt-5.4', label: 'GPT-5.4' },
]

const IMAGE_MODELS = [
  { id: 'openai/gpt-5-image-mini', label: 'GPT-5 Image' },
  { id: 'google/gemini-2.5-flash-image', label: 'Gemini 2.5 Flash' },
  { id: 'black-forest-labs/flux.2-flex', label: 'Flux 2 Flex' },
]

export function ChatPanel({
  projectId,
  initialMessages,
  onDone,
}: {
  projectId: string
  initialMessages: Message[]
  onDone?: () => void
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [steps, setSteps] = useState<StepInfo[]>([])
  const [model, setModel] = useState(MODELS[0].id)
  const [imageModel, setImageModel] = useState(IMAGE_MODELS[0].id)
  const [showSettings, setShowSettings] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, steps, scrollToBottom])

  function addStep(label: string) {
    setSteps(prev => {
      // Mark all previous active steps as done
      const updated = prev.map(s => s.status === 'active' ? { ...s, status: 'done' as const } : s)
      return [...updated, { label, status: 'active' }]
    })
  }

  function completeAllSteps() {
    setSteps(prev => prev.map(s => ({ ...s, status: 'done' as const })))
  }

  function handleStop() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }

  async function handleSubmit() {
    const text = input.trim()
    if (!text || isLoading) return

    setInput('')
    setIsLoading(true)
    setSteps([])

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, message: text, model, imageModel }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        throw new Error('Chat request failed')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let assistantContent = ''

      // Timeout: if no SSE event arrives for 90 seconds, assume the server is stuck
      const STREAM_TIMEOUT_MS = 5 * 60_000 // 5 minutes
      let streamTimer: ReturnType<typeof setTimeout> | null = null
      const resetStreamTimer = () => {
        if (streamTimer) clearTimeout(streamTimer)
        streamTimer = setTimeout(() => {
          controller.abort()
        }, STREAM_TIMEOUT_MS)
      }
      resetStreamTimer()

      try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        resetStreamTimer()
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)

          try {
            const event: TaskEvent = JSON.parse(data)

            if (event.type === 'status') {
              addStep(event.message ?? 'Working...')
            } else if (event.type === 'message') {
              addStep(event.message ?? 'Processing...')
              if (event.message) assistantContent = event.message
            } else if (event.type === 'compile_start') {
              addStep('Compiling your book...')
            } else if (event.type === 'compile_done') {
              addStep('Book compiled successfully!')
              completeAllSteps()
            } else if (event.type === 'compile_error') {
              addStep(event.error ?? 'Compilation failed')
            } else if (event.type === 'done') {
              if (event.message) assistantContent = event.message
              completeAllSteps()
            }
          } catch {
            // ignore parse errors
          }
        }
      }
      } finally {
        if (streamTimer) clearTimeout(streamTimer)
      }

      if (assistantContent) {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: assistantContent,
          created_at: new Date().toISOString(),
        }])
      }

      onDone?.()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Check if this was a manual stop or a timeout
        const wasManualStop = abortControllerRef.current === null
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: wasManualStop
            ? 'Request stopped.'
            : 'The request timed out — the server may still be processing. Please try again with a simpler edit.',
          created_at: new Date().toISOString(),
        }])
      } else {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
          created_at: new Date().toISOString(),
        }])
      }
    } finally {
      setIsLoading(false)
      setSteps([])
      abortControllerRef.current = null
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.tex', '.html', '.xml', '.rtf', '.srt', '.sub', '.log']

  function isTextFile(file: File): boolean {
    if (file.type.startsWith('text/')) return true
    if (file.type === 'application/json') return true
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    return TEXT_EXTENSIONS.includes(ext)
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset input so the same file can be re-selected
    e.target.value = ''

    if (isTextFile(file)) {
      // Text files: read content and inject into the message
      try {
        const text = await file.text()
        const truncated = text.length > 100_000 ? text.slice(0, 100_000) + '\n...(truncated)' : text
        setInput(prev => {
          const prefix = prev.trim() ? prev.trim() + '\n\n' : ''
          return prefix + `[File: ${file.name}]\n${truncated}\n[/File]`
        })
        inputRef.current?.focus()
      } catch {
        alert('Could not read file')
      }
    } else {
      // Images: upload to storage
      const formData = new FormData()
      formData.append('file', file)
      formData.append('projectId', projectId)

      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      if (res.ok) {
        const data = await res.json()
        // Use the actual stored filename (includes upload-{timestamp} prefix)
        const storedName = data.storage_path?.split('/').pop() || file.name
        setInput(prev => prev + `\n[Uploaded: ${storedName}]`)
        inputRef.current?.focus()
      }
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with model settings */}
      <div className="p-3 border-b border-purple-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">AI Assistant</h3>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="rounded-lg p-1.5 hover:bg-purple-50 transition-colors"
          title="Model settings"
        >
          <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {/* Model selectors (collapsible) */}
      {showSettings && (
        <div className="p-3 border-b border-purple-100 bg-purple-50/50 space-y-2">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">AI Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="mt-1 w-full rounded-lg border border-purple-100 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/20"
            >
              {MODELS.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Image Model</label>
            <select
              value={imageModel}
              onChange={(e) => setImageModel(e.target.value)}
              className="mt-1 w-full rounded-lg border border-purple-100 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/20"
            >
              {IMAGE_MODELS.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <div className="w-12 h-12 rounded-2xl gradient-bg-subtle flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
              </svg>
            </div>
            <p className="font-medium text-sm">How can I help with your book?</p>
            <p className="text-xs text-muted-foreground mt-2 max-w-[250px] mx-auto leading-relaxed">
              Try &quot;Add a chapter about space exploration&quot; or &quot;Make the title page more colorful&quot;
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`text-sm ${
              msg.role === 'user'
                ? 'flex justify-end'
                : ''
            }`}
          >
            {msg.role === 'user' ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-md gradient-bg px-4 py-2.5 text-white">
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            ) : (
              <div className="max-w-[90%]">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-5 h-5 rounded-md gradient-bg flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                  </div>
                  <span className="text-[11px] font-medium text-muted-foreground">AI</span>
                </div>
                <div className="rounded-2xl rounded-tl-md bg-purple-50/70 px-4 py-2.5">
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Intermediary steps indicator */}
        {steps.length > 0 && (
          <div className="bg-purple-50/80 rounded-xl px-4 py-3 space-y-2">
            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-2.5 text-xs">
                {step.status === 'active' ? (
                  <svg className="animate-spin w-3.5 h-3.5 text-purple-500 shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                <span className={step.status === 'active' ? 'text-purple-700 font-medium' : 'text-muted-foreground'}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-purple-100 p-3">
        <div className="rounded-xl border border-purple-100 bg-white focus-within:border-purple-300 focus-within:ring-2 focus-within:ring-purple-500/10 transition-all">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you'd like to change..."
            rows={2}
            disabled={isLoading}
            className="w-full px-4 pt-3 pb-1 text-sm resize-none border-0 bg-transparent focus:outline-none disabled:opacity-50 placeholder:text-muted-foreground/60"
          />
          <div className="flex justify-between items-center px-3 pb-2">
            <label className="cursor-pointer rounded-lg p-1.5 hover:bg-purple-50 transition-colors text-muted-foreground hover:text-purple-600" title="Attach file (image or text)">
              <input type="file" accept="image/*,.txt,.md,.csv,.json,.tex,.html,.xml,.rtf,.srt,.log" onChange={handleFileUpload} className="hidden" />
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </label>
            {isLoading ? (
              <button
                onClick={handleStop}
                className="rounded-lg bg-red-50 border border-red-200 px-4 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 transition-all flex items-center gap-1.5"
                title="Stop generation"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                Stop
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!input.trim()}
                className="rounded-lg gradient-bg px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-30 transition-all shadow-sm shadow-purple-500/20"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

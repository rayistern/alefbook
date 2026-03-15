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
  task?: { type: string; status: string; pageNumber?: number; description?: string }
  message?: string
  error?: string
}

const MODELS = [
  { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
  { id: 'anthropic/claude-haiku-4', label: 'Claude Haiku 4' },
  { id: 'openai/gpt-4.1', label: 'GPT-4.1' },
  { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
]

const IMAGE_MODELS = [
  { id: 'openai/dall-e-3', label: 'DALL-E 3' },
  { id: 'stability/stable-diffusion-xl', label: 'SDXL' },
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
  const [taskStatus, setTaskStatus] = useState<string | null>(null)
  const [model, setModel] = useState(MODELS[0].id)
  const [imageModel, setImageModel] = useState(IMAGE_MODELS[0].id)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, taskStatus, scrollToBottom])

  async function handleSubmit() {
    const text = input.trim()
    if (!text || isLoading) return

    setInput('')
    setIsLoading(true)
    setTaskStatus(null)

    // Optimistic add user message
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, message: text, model, imageModel }),
      })

      if (!res.ok || !res.body) {
        throw new Error('Chat request failed')
      }

      // Read SSE stream
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let assistantContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)

          try {
            const event: TaskEvent = JSON.parse(data)

            if (event.type === 'plan' || event.type === 'message') {
              setTaskStatus(event.message ?? null)
              if (event.message) assistantContent = event.message
            } else if (event.type === 'task_start') {
              setTaskStatus(`${event.task?.description ?? 'Working'}...`)
            } else if (event.type === 'task_done') {
              setTaskStatus(`Done: ${event.task?.description ?? ''}`)
            } else if (event.type === 'task_error') {
              setTaskStatus(`Error: ${event.error ?? 'Unknown'}`)
            } else if (event.type === 'compile_start') {
              setTaskStatus('Compiling LaTeX...')
            } else if (event.type === 'compile_done') {
              setTaskStatus('PDF ready!')
            } else if (event.type === 'compile_error') {
              setTaskStatus(`Compile error: ${event.error}`)
            } else if (event.type === 'done') {
              if (event.message) assistantContent = event.message
            }
          } catch {
            // ignore parse errors
          }
        }
      }

      // Add assistant message
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
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
        created_at: new Date().toISOString(),
      }])
    } finally {
      setIsLoading(false)
      setTaskStatus(null)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)
    formData.append('projectId', projectId)

    const res = await fetch('/api/upload', { method: 'POST', body: formData })
    if (res.ok) {
      setInput(prev => prev + `\n[Uploaded: ${file.name}]`)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Model selectors */}
      <div className="p-3 border-b flex gap-2">
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
        >
          {MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <select
          value={imageModel}
          onChange={(e) => setImageModel(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
        >
          {IMAGE_MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8">
            <p className="font-medium">Start chatting to edit your book</p>
            <p className="mt-1">Try: &quot;Change all headings to blue&quot; or &quot;Add a table of contents&quot;</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`text-sm ${
              msg.role === 'user'
                ? 'bg-primary/5 rounded-lg p-3'
                : 'pl-1'
            }`}
          >
            <p className="text-xs font-medium text-muted-foreground mb-1">
              {msg.role === 'user' ? 'You' : 'AI'}
            </p>
            <p className="whitespace-pre-wrap">{msg.content}</p>
          </div>
        ))}

        {taskStatus && (
          <div className="text-xs text-muted-foreground bg-muted rounded-md p-2 animate-pulse">
            {taskStatus}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t p-3 space-y-2">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the AI to edit your book..."
            rows={2}
            disabled={isLoading}
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none disabled:opacity-50"
          />
        </div>
        <div className="flex justify-between items-center">
          <label className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
            Upload Image
          </label>
          <button
            onClick={handleSubmit}
            disabled={isLoading || !input.trim()}
            className="rounded-md bg-primary px-4 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isLoading ? 'Working...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { ArrowUp } from 'lucide-react'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

interface ChatPanelProps {
  messages: ChatMessage[]
  onSend: (message: string) => void
  isWorking: boolean
  passInfo?: { current: number; total: number } | null
}

const CONVERSATION_STARTERS = [
  'Put my name on the cover',
  'Change the picture of matzah to look like a photograph',
  'Make the fonts more modern',
  'Add a family photo placeholder',
]

export function ChatPanel({ messages, onSend, isWorking, passInfo }: ChatPanelProps) {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
  }, [input])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isWorking) return
    onSend(trimmed)
    setInput('')
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, isWorking, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const handleStarterClick = useCallback(
    (starter: string) => {
      if (isWorking) return
      onSend(starter)
    },
    [isWorking, onSend]
  )

  const designingLabel = passInfo
    ? passInfo.current <= 1
      ? 'Designing...'
      : `Designing... (pass ${passInfo.current}/${passInfo.total})`
    : 'Designing...'

  const showStarters = messages.length === 0 && !isWorking

  return (
    <div className="flex h-full w-full flex-col border-r">
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold">Chat</h2>
      </div>

      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="flex flex-col gap-6 px-4 py-4">
          {showStarters && (
            <div className="flex flex-1 flex-col justify-end gap-2 pt-4">
              <p className="mb-2 text-sm text-muted-foreground">
                Try one of these to get started:
              </p>
              <div className="flex flex-col gap-2">
                {CONVERSATION_STARTERS.map(starter => (
                  <button
                    key={starter}
                    onClick={() => handleStarterClick(starter)}
                    className="rounded-lg border px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} className="flex flex-col gap-1">
              {msg.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-3xl bg-muted px-4 py-2.5 text-sm">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div className="text-sm leading-relaxed text-foreground">
                  {msg.content}
                </div>
              )}
            </div>
          ))}

          {isWorking && (
            <div className="text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="flex gap-0.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
                </span>
                <span>{designingLabel}</span>
              </span>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t p-3">
        <div className="relative flex items-end rounded-2xl border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isWorking ? 'Waiting for response...' : 'Message...'}
            disabled={isWorking}
            className="max-h-[160px] min-h-[44px] flex-1 resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            rows={1}
          />
          <div className="p-2">
            <Button
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={handleSend}
              disabled={isWorking || !input.trim()}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}

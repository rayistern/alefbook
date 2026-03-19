import { createServerSupabase } from '@/lib/supabase/server'
import { runOrchestrator, type TaskEvent } from '@/lib/ai/orchestrator'
import { NextRequest } from 'next/server'

export const maxDuration = 300 // 5 minutes for agentic loop

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { projectId, message, model, imageModel } = await request.json()

  if (!projectId || !message) {
    return new Response('Missing projectId or message', { status: 400 })
  }

  // Verify project ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .single()

  if (!project || project.user_id !== user.id) {
    return new Response('Not found', { status: 404 })
  }

  // Save user message
  await supabase.from('messages').insert({
    project_id: projectId,
    role: 'user',
    content: message,
  })

  // Load chat history
  const { data: history } = await supabase
    .from('messages')
    .select('role, content')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .limit(50)

  // Use the request signal to detect client disconnection
  const requestSignal = request.signal

  // Stream the orchestrator events via SSE
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const events = runOrchestrator({
          projectId,
          userMessage: message,
          chatHistory: (history ?? []).map(m => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
          })),
          model,
          imageModel,
        })

        for await (const event of events) {
          // Check if client has disconnected
          if (requestSignal.aborted) {
            break
          }
          const data = JSON.stringify(event)
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const errType = err?.constructor?.name ?? 'Unknown'
        console.error(`[Chat SSE] Stream error: [${errType}] ${errMsg}`)

        if (requestSignal.aborted) {
          console.warn('[Chat SSE] Client disconnected during stream')
          return
        }
        const errorEvent: TaskEvent = {
          type: 'done',
          error: `Error: ${errMsg}`,
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

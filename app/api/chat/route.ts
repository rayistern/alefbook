import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/storage/supabase'
import { checkLimit } from '@/lib/rate-limit/upstash'
import { runDesignerLoop } from '@/lib/ai/designer-agent'
import { loadTemplateMeta } from '@/lib/templates/loader'
import { getPageStates } from '@/lib/templates/page-state'
import { getProjectUploads } from '@/lib/storage/uploads'
import { loadAllPageStates } from '@/lib/templates/loader'

export async function POST(req: Request) {
  const { userId: clerkId } = await auth()
  if (!clerkId) return new Response('Unauthorized', { status: 401 })

  // Rate limit check
  const limitResult = await checkLimit('aiCalls', clerkId)
  if (!limitResult.allowed) {
    return Response.json(
      {
        error: `You've made a lot of edits! Your limit resets in ${Math.ceil((limitResult.retryAfterSeconds ?? 60) / 60)} minutes.`,
      },
      { status: 429 }
    )
  }

  const body = await req.json()
  const { message, projectId, currentPage } = body

  if (!message || !projectId || !currentPage) {
    return new Response('Missing required fields', { status: 400 })
  }

  // Verify project ownership
  const supabase = createClient()
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_id', clerkId)
    .single()

  if (!user) return new Response('User not found', { status: 404 })

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!project) return new Response('Project not found', { status: 404 })

  // Save user message
  await supabase.from('messages').insert({
    project_id: projectId,
    role: 'user',
    content: message,
    page_context: currentPage,
  })

  // Load context
  const templateMeta = loadTemplateMeta()
  const projectPageStates = await getPageStates(projectId)
  const pageStates = loadAllPageStates(projectPageStates)
  const uploads = await getProjectUploads(projectId)

  // Load chat history
  const { data: messages } = await supabase
    .from('messages')
    .select('role, content')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .limit(50)

  const chatHistory = (messages ?? []).map(m => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }))

  try {
    // Run the designer loop
    const result = await runDesignerLoop({
      userMessage: message,
      currentPage,
      projectId,
      pageStates,
      chatHistory,
      templateMeta,
      uploads,
      projectName: project.name,
    })

    // Save assistant response
    await supabase.from('messages').insert({
      project_id: projectId,
      role: 'assistant',
      content: result.responseText,
      page_context: currentPage,
    })

    // Cache renders in Supabase Storage
    const renderUrls: Record<number, string> = {}
    for (const [pageNumStr, buffer] of Object.entries(result.renders)) {
      const pageNum = Number(pageNumStr)
      const path = `projects/${projectId}/renders/page-${pageNum}.png`

      await supabase.storage
        .from('renders')
        .upload(path, buffer, {
          contentType: 'image/png',
          upsert: true,
        })

      const { data: urlData } = supabase.storage
        .from('renders')
        .getPublicUrl(path)

      renderUrls[pageNum] = urlData.publicUrl
    }

    return Response.json({
      responseText: result.responseText,
      updatedPages: result.updatedPages,
      renderUrls,
      passCount: result.passCount,
      reviewPassed: result.reviewPassed,
    })
  } catch (error) {
    console.error('Designer loop failed:', error)
    return Response.json(
      { error: 'Something went wrong while designing. Please try again.' },
      { status: 500 }
    )
  }
}

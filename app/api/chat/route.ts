import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/storage/supabase'
import { getOrCreateUserId } from '@/lib/storage/user'
import { checkLimit } from '@/lib/rate-limit/upstash'
import { runDesignerLoop } from '@/lib/ai/designer-agent'
import { loadTemplateMeta } from '@/lib/templates/loader'
import { getPageStates } from '@/lib/templates/page-state'
import { getProjectUploads } from '@/lib/storage/uploads'
import { loadAllPageStates } from '@/lib/templates/loader'

export async function POST(req: Request) {
  const { userId: clerkId } = await auth()
  if (!clerkId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

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
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Verify project ownership
  const supabase = createClient()
  const dbUserId = await getOrCreateUserId(clerkId)

  if (!dbUserId) return Response.json({ error: 'User not found' }, { status: 404 })

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', dbUserId)
    .single()

  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 })

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
    console.log('[Chat API] Starting designer loop:', {
      projectId,
      currentPage,
      messageLength: message.length,
      pageCount: Object.keys(pageStates).length,
      historyLength: chatHistory.length,
      uploadCount: uploads.length,
    })

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

    console.log('[Chat API] Designer loop completed:', {
      passCount: result.passCount,
      reviewPassed: result.reviewPassed,
      updatedPages: result.updatedPages,
      renderedPages: Object.keys(result.renders),
      unresolvedIssues: result.unresolvedIssues,
      responseTextLength: result.responseText?.length,
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
      const storagePath = `projects/${projectId}/renders/page-${pageNum}.png`

      const { error: uploadError } = await supabase.storage
        .from('renders')
        .upload(storagePath, buffer, {
          contentType: 'image/png',
          upsert: true,
        })

      if (uploadError) {
        console.error(`Storage upload failed for page ${pageNum}:`, uploadError.message)
        continue
      }

      const { data: signedData, error: signError } = await supabase.storage
        .from('renders')
        .createSignedUrl(storagePath, 3600)

      if (!signError && signedData?.signedUrl) {
        renderUrls[pageNum] = signedData.signedUrl
      }
    }

    return Response.json({
      responseText: result.responseText,
      updatedPages: result.updatedPages,
      renderUrls,
      passCount: result.passCount,
      reviewPassed: result.reviewPassed,
      unresolvedIssues: result.unresolvedIssues,
    })
  } catch (error) {
    console.error('[Chat API] Designer loop failed:', error instanceof Error ? { message: error.message, stack: error.stack } : error)
    return Response.json(
      { error: 'Something went wrong while designing. Please try again.' },
      { status: 500 }
    )
  }
}

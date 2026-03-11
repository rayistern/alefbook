import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/storage/supabase'
import { getOrCreateUserId } from '@/lib/storage/user'
import { loadTemplateMeta } from '@/lib/templates/loader'
import { getProjectUploads, getUploadDisplayUrl } from '@/lib/storage/uploads'
import { DesignerShell } from '@/components/designer/DesignerShell'
import type { ChatMessage } from '@/components/designer/ChatPanel'

interface DesignerPageProps {
  params: { projectId: string }
}

export default async function DesignerPage({ params }: DesignerPageProps) {
  console.log('[Designer] Loading page for project:', params.projectId)

  const { userId: clerkId } = await auth()
  if (!clerkId) {
    console.log('[Designer] No clerkId, redirecting to sign-in')
    redirect('/sign-in')
  }
  console.log('[Designer] Authenticated as clerkId:', clerkId)

  const supabase = createClient()

  // Get or create DB user (handles webhook race condition)
  const dbUserId = await getOrCreateUserId(clerkId)
  console.log('[Designer] DB user ID:', dbUserId)

  if (!dbUserId) redirect('/dashboard')

  // Load project (with ownership check)
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('*')
    .eq('id', params.projectId)
    .eq('user_id', dbUserId)
    .single()

  console.log('[Designer] Project loaded:', project?.id, 'error:', projectError?.message)
  if (!project) redirect('/dashboard')

  // Load template metadata
  const templateMeta = loadTemplateMeta()
  console.log('[Designer] Template loaded:', templateMeta.page_count, 'pages,', templateMeta.pages.length, 'page entries')

  // Load chat messages
  const { data: messages, error: msgError } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('project_id', params.projectId)
    .order('created_at', { ascending: true })

  console.log('[Designer] Messages loaded:', messages?.length ?? 0, 'error:', msgError?.message)

  const chatMessages: ChatMessage[] = (messages ?? []).map(m => ({
    id: m.id,
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
    createdAt: m.created_at,
  }))

  // Load uploads
  const uploads = await getProjectUploads(params.projectId)
  console.log('[Designer] Uploads loaded:', uploads.length)
  const uploadImages = await Promise.all(
    uploads.map(async u => ({
      id: u.id,
      filename: u.filename,
      displayUrl: await getUploadDisplayUrl(u.storage_path_display),
    }))
  )

  // Determine which pages have been edited
  const pageStates = (project.page_states ?? {}) as Record<string, string>
  const editedPages = Object.keys(pageStates).map(Number)
  console.log('[Designer] Edited pages:', editedPages)

  // Build initial render URLs from cached renders
  const { data: renders, error: renderError } = await supabase
    .from('renders')
    .select('page_number, image_path')
    .eq('project_id', params.projectId)

  console.log('[Designer] Cached renders:', renders?.length ?? 0, 'error:', renderError?.message)

  const renderUrls: Record<number, string> = {}
  for (const render of renders ?? []) {
    const { data: urlData } = supabase.storage
      .from('renders')
      .getPublicUrl(render.image_path)
    renderUrls[render.page_number] = urlData.publicUrl
  }

  console.log('[Designer] Passing to DesignerShell:', {
    projectId: params.projectId,
    projectName: project.name,
    totalPages: templateMeta.page_count,
    pagesCount: templateMeta.pages.length,
    messagesCount: chatMessages.length,
    uploadsCount: uploadImages.length,
    renderUrlsCount: Object.keys(renderUrls).length,
    editedPagesCount: editedPages.length,
  })

  return (
    <DesignerShell
      projectId={params.projectId}
      projectName={project.name}
      totalPages={templateMeta.page_count}
      pages={templateMeta.pages}
      initialMessages={chatMessages}
      initialUploads={uploadImages}
      initialRenderUrls={renderUrls}
      initialEditedPages={editedPages}
      shopifyVariantId={process.env.SHOPIFY_HAGGADAH_VARIANT_ID}
      shopifyStoreUrl={process.env.SHOPIFY_STORE_URL}
    />
  )
}

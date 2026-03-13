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
  const { userId: clerkId } = await auth()
  if (!clerkId) redirect('/sign-in')

  const supabase = createClient()

  // Get or create DB user (handles webhook race condition)
  const dbUserId = await getOrCreateUserId(clerkId)

  if (!dbUserId) redirect('/dashboard')

  // Load project (with ownership check)
  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', params.projectId)
    .eq('user_id', dbUserId)
    .single()

  if (!project) redirect('/dashboard')

  // Load template metadata
  const projectFormat = (project.format as 'html' | 'latex') || 'html'
  const templateMeta = loadTemplateMeta(project.template_id)

  // Load chat messages
  const { data: messages } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('project_id', params.projectId)
    .order('created_at', { ascending: true })

  const chatMessages: ChatMessage[] = (messages ?? []).map(m => ({
    id: m.id,
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
    createdAt: m.created_at,
  }))

  // Load uploads
  const uploads = await getProjectUploads(params.projectId)
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

  // Build initial render URLs from cached renders
  const { data: renders } = await supabase
    .from('renders')
    .select('page_number, image_path')
    .eq('project_id', params.projectId)

  const renderUrls: Record<number, string> = {}
  for (const render of renders ?? []) {
    const { data: signedData, error: signError } = await supabase.storage
      .from('renders')
      .createSignedUrl(render.image_path, 3600)
    if (!signError && signedData?.signedUrl) {
      renderUrls[render.page_number] = signedData.signedUrl
    }
  }

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
      projectFormat={projectFormat}
      shopifyVariantId={process.env.SHOPIFY_HAGGADAH_VARIANT_ID}
      shopifyStoreUrl={process.env.SHOPIFY_STORE_URL}
    />
  )
}

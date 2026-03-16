import { createServerSupabase } from '@/lib/supabase/server'
import { getProjectPdfUrl } from '@/lib/latex/compiler'
import { redirect, notFound } from 'next/navigation'
import { ProjectEditor } from '@/components/project/ProjectEditor'

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!project) notFound()

  // Check access
  const isOwner = project.user_id === user.id
  if (!isOwner && !project.is_public) notFound()

  // Get PDF URL
  const pdfUrl = project.pdf_path ? await getProjectPdfUrl(params.id) : null

  // Get chat history (owner only)
  let messages: { id: string; role: string; content: string; metadata: unknown; created_at: string }[] = []
  if (isOwner) {
    const { data } = await supabase
      .from('messages')
      .select('id, role, content, metadata, created_at')
      .eq('project_id', params.id)
      .order('created_at', { ascending: true })

    messages = data ?? []
  }

  return (
    <ProjectEditor
      project={project}
      pdfUrl={pdfUrl}
      initialMessages={messages}
      isOwner={isOwner}
    />
  )
}

import { createServerSupabase } from '@/lib/supabase/server'
import { getProjectPdfUrl } from '@/lib/latex/compiler'
import { notFound } from 'next/navigation'
import { ProjectEditor } from '@/components/project/ProjectEditor'

export default async function ViewProjectPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase()
  if (!supabase) notFound()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: project } = await supabase
    .from('projects')
    .select('*, profiles(display_name)')
    .eq('id', params.id)
    .single()

  if (!project) notFound()

  // Must be public or owned by user
  if (!project.is_public && project.user_id !== user?.id) notFound()

  const pdfUrl = project.pdf_path ? await getProjectPdfUrl(params.id) : null
  const isOwner = user?.id === project.user_id

  return (
    <ProjectEditor
      project={project}
      pdfUrl={pdfUrl}
      initialMessages={[]}
      isOwner={isOwner}
    />
  )
}

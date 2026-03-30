import { createServerSupabase } from '@/lib/supabase/server'
import { getProjectPdfUrl, getProjectBleedPdfUrl } from '@/lib/latex/compiler'
import { notFound } from 'next/navigation'
import { ProjectEditor } from '@/components/project/ProjectEditor'

export default async function ViewProjectPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: project } = await supabase
    .from('projects')
    .select('*, profiles(display_name)')
    .eq('id', params.id)
    .single()

  if (!project) notFound()

  // Must be public or owned by user
  if (!project.is_public && project.user_id !== user?.id) notFound()

  const [pdfUrl, bleedPdfUrl] = project.pdf_path
    ? await Promise.all([getProjectPdfUrl(params.id), getProjectBleedPdfUrl(params.id)])
    : [null, null]
  const isOwner = user?.id === project.user_id

  return (
    <ProjectEditor
      project={project}
      pdfUrl={pdfUrl}
      bleedPdfUrl={bleedPdfUrl}
      initialMessages={[]}
      isOwner={isOwner}
      isLoggedIn={!!user}
    />
  )
}

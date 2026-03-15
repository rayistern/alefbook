import { createServerSupabase } from '@/lib/supabase/server'
import { compileProject, getProjectPdfUrl } from '@/lib/latex/compiler'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 120

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { projectId } = await request.json()

  // Verify ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .single()

  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const result = await compileProject(projectId)

  if (result.success) {
    const pdfUrl = await getProjectPdfUrl(projectId)
    return NextResponse.json({ success: true, pdfUrl })
  } else {
    return NextResponse.json({ success: false, errors: result.errors }, { status: 422 })
  }
}

import { createServerSupabase } from '@/lib/supabase/server'
import { readProjectFile, uploadProjectFile, compileProject, getProjectPdfUrl } from '@/lib/latex/compiler'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/project/[id]/undo — restore the pre-edit snapshot
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify ownership
  const { data: project } = await supabase
    .from('projects')
    .select('user_id')
    .eq('id', params.id)
    .single()

  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Read the snapshot
  const snapshot = await readProjectFile(params.id, 'snapshots/pre-edit.tex')
  if (!snapshot) {
    return NextResponse.json({ error: 'No undo snapshot available' }, { status: 404 })
  }

  // Restore it
  await uploadProjectFile(params.id, 'main.tex', snapshot)

  // Recompile
  const result = await compileProject(params.id, snapshot)
  if (result.success) {
    const pdfUrl = await getProjectPdfUrl(params.id)
    return NextResponse.json({ success: true, pdfUrl })
  }

  return NextResponse.json({ success: true, message: 'Document restored but recompile failed' })
}

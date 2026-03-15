import { createServerSupabase } from '@/lib/supabase/server'
import { uploadProjectImage } from '@/lib/latex/compiler'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const projectId = formData.get('projectId') as string | null

  if (!file || !projectId) {
    return NextResponse.json({ error: 'Missing file or projectId' }, { status: 400 })
  }

  // Verify ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .single()

  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Upload to storage
  const buffer = Buffer.from(await file.arrayBuffer())
  const filename = `upload-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const storagePath = await uploadProjectImage(projectId, filename, buffer, file.type)

  // Record in uploads table
  const { data: upload } = await supabase
    .from('uploads')
    .insert({
      project_id: projectId,
      filename: file.name,
      storage_path: storagePath,
      mime_type: file.type,
    })
    .select()
    .single()

  return NextResponse.json(upload, { status: 201 })
}

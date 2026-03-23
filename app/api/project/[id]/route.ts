import { createServerSupabase } from '@/lib/supabase/server'
import { getProjectPdfUrl, getProjectBleedPdfUrl } from '@/lib/latex/compiler'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/project/[id] — get project details
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: project } = await supabase
    .from('projects')
    .select('*, profiles(display_name, avatar_url)')
    .eq('id', params.id)
    .single()

  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Check access: owner or public
  if (project.user_id !== user?.id && !project.is_public) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Get PDF URLs if available
  const [pdfUrl, bleedPdfUrl] = project.pdf_path
    ? await Promise.all([getProjectPdfUrl(params.id), getProjectBleedPdfUrl(params.id)])
    : [null, null]

  // Get chat history if owner
  let messages = null
  if (user && project.user_id === user.id) {
    const { data } = await supabase
      .from('messages')
      .select('id, role, content, metadata, created_at')
      .eq('project_id', params.id)
      .order('created_at', { ascending: true })

    messages = data
  }

  return NextResponse.json({
    ...project,
    pdfUrl,
    bleedPdfUrl,
    messages,
    isOwner: user?.id === project.user_id,
  })
}

// PATCH /api/project/[id] — update project
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const updates = await request.json()

  // Only allow certain fields
  const allowed = ['name', 'description', 'is_public']
  const filtered: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in updates) filtered[key] = updates[key]
  }

  const { data, error } = await supabase
    .from('projects')
    .update(filtered)
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(data)
}

// DELETE /api/project/[id] — delete project
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Delete storage files
  const { data: files } = await supabase.storage
    .from('projects')
    .list(`projects/${params.id}`, { limit: 1000 })

  if (files && files.length > 0) {
    await supabase.storage
      .from('projects')
      .remove(files.map(f => `projects/${params.id}/${f.name}`))
  }

  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

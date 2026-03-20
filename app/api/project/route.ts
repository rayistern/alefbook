import { createServerSupabase } from '@/lib/supabase/server'
import { uploadProjectFile, copyTemplatePdf, getProjectPdfUrl } from '@/lib/latex/compiler'
import { NextRequest, NextResponse } from 'next/server'
import { getTemplate } from '@/lib/latex/templates'

// GET /api/project — list user's projects
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, description, page_count, status, is_public, fork_count, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  return NextResponse.json(projects ?? [])
}

// POST /api/project — create a new project
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { name, templateId, pageCount } = await request.json()

  const tid = templateId || 'blank'
  const template = getTemplate(tid, pageCount || 10)

  // For template projects, use the template's known page count
  const templatePageCounts: Record<string, number> = {
    'haggadah': 52,
    'haggadah-kids': 52,
  }
  const effectivePageCount = pageCount || templatePageCounts[tid] || 10

  // Create project record
  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      user_id: user.id,
      name: name || 'Untitled Book',
      template_id: tid,
      page_count: effectivePageCount,
    })
    .select()
    .single()

  if (error || !project) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create project' }, { status: 500 })
  }

  // Upload the single main.tex document
  await uploadProjectFile(project.id, 'main.tex', template.main)

  // Template images (korech1a.png, etc.) are NOT uploaded to Supabase.
  // They live on the Docker filesystem and are found via TEXINPUTS during
  // compilation. This avoids stale copies when images are updated.

  // Copy the pre-compiled template PDF so user sees it immediately
  const copied = await copyTemplatePdf(project.id, tid)
  if (copied) {
    const pdfUrl = await getProjectPdfUrl(project.id)
    return NextResponse.json({ ...project, status: 'ready', pdfUrl }, { status: 201 })
  }

  return NextResponse.json(project, { status: 201 })
}

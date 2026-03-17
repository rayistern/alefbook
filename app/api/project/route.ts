import { createServerSupabase } from '@/lib/supabase/server'
import { uploadProjectFile, compileProject, getProjectPdfUrl } from '@/lib/latex/compiler'
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
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { name, templateId, pageCount } = await request.json()

  const template = getTemplate(templateId || 'blank', pageCount || 10)

  // Create project record
  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      user_id: user.id,
      name: name || 'Untitled Book',
      template_id: templateId || 'blank',
      page_count: pageCount || 0,
    })
    .select()
    .single()

  if (error || !project) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create project' }, { status: 500 })
  }

  // Upload the single main.tex document
  await uploadProjectFile(project.id, 'main.tex', template.main)

  // Auto-compile the template so user sees a PDF immediately
  try {
    const result = await compileProject(project.id)
    if (result.success) {
      const pdfUrl = await getProjectPdfUrl(project.id)
      return NextResponse.json({ ...project, status: 'ready', pdfUrl }, { status: 201 })
    }
  } catch (err) {
    console.error('[Project] Auto-compile failed:', err)
  }

  return NextResponse.json(project, { status: 201 })
}

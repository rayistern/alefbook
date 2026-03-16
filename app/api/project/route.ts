import { createServerSupabase } from '@/lib/supabase/server'
import { uploadProjectFile } from '@/lib/latex/compiler'
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

  // Generate template files first (haggadah has fixed page count)
  const template = getTemplate(templateId || 'blank', pageCount || 10)
  const actualPageCount = Object.keys(template.pages).length

  // Create project record
  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      user_id: user.id,
      name: name || 'Untitled Book',
      template_id: templateId || 'blank',
      page_count: actualPageCount,
    })
    .select()
    .single()

  if (error || !project) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create project' }, { status: 500 })
  }

  // Upload main.tex
  await uploadProjectFile(project.id, 'main.tex', template.main)
  // Upload preamble.tex
  await uploadProjectFile(project.id, 'preamble.tex', template.preamble)
  // Upload page files
  for (const [filename, content] of Object.entries(template.pages)) {
    await uploadProjectFile(project.id, `pages/${filename}`, content)
  }

  return NextResponse.json(project, { status: 201 })
}

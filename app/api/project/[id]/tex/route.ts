import { createServerSupabase } from '@/lib/supabase/server'
import { readProjectFile, uploadProjectFile } from '@/lib/latex/compiler'
import { NextRequest, NextResponse } from 'next/server'
import { sanitizeLatex, validateLatex } from '@/lib/ai/latex-editor'

/**
 * GET /api/project/[id]/tex — Download the raw main.tex
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id, name')
    .eq('id', projectId)
    .single()

  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Allow owners and viewers of public projects
  if (project.user_id !== user.id) {
    const { data: pub } = await supabase
      .from('projects')
      .select('is_public')
      .eq('id', projectId)
      .single()
    if (!pub?.is_public) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  const tex = await readProjectFile(projectId, 'main.tex')
  if (!tex) {
    return NextResponse.json({ error: 'No LaTeX file found' }, { status: 404 })
  }

  const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'document'

  return new NextResponse(tex, {
    headers: {
      'Content-Type': 'application/x-tex; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName}.tex"`,
    },
  })
}

/**
 * PUT /api/project/[id]/tex — Upload/replace the raw main.tex
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .single()

  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const tex = await request.text()

  if (!tex || tex.length < 50) {
    return NextResponse.json({ error: 'File too small or empty' }, { status: 400 })
  }

  if (tex.length > 2_000_000) {
    return NextResponse.json({ error: 'File too large (max 2MB)' }, { status: 400 })
  }

  const sanitized = sanitizeLatex(tex)
  const validation = validateLatex(sanitized)

  if (!validation.valid) {
    return NextResponse.json(
      { error: 'Invalid LaTeX', warnings: validation.warnings },
      { status: 400 }
    )
  }

  await uploadProjectFile(projectId, 'main.tex', sanitized)

  return NextResponse.json({
    ok: true,
    warnings: validation.warnings.length > 0 ? validation.warnings : undefined,
  })
}

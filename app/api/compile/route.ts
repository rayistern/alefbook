import { createServerSupabase } from '@/lib/supabase/server'
import { compileProject, getProjectPdfUrl, getProjectBleedPdfUrl } from '@/lib/latex/compiler'
import { checkLimit } from '@/lib/rate-limit/upstash'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 120

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // CPU guard: a manual compile runs latexmk (up to 120s of CPU) on the
  // single shared container. Uses the pre-existing pdfExports window
  // (5/hour/user, defined in lib/rate-limit/upstash.ts — tune there if too
  // tight; most compiles happen implicitly inside chat turns, which are
  // governed by the aiCalls window instead). Fail-open when Upstash isn't
  // configured.
  const limit = await checkLimit('pdfExports', user.id)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Compile rate limit exceeded. Please wait before recompiling.' },
      {
        status: 429,
        headers: limit.retryAfterSeconds ? { 'Retry-After': String(limit.retryAfterSeconds) } : undefined,
      }
    )
  }

  const { projectId } = await request.json()

  // Verify ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id, template_id')
    .eq('id', projectId)
    .single()

  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const result = await compileProject(projectId, undefined, project.template_id)

  if (result.success) {
    const [pdfUrl, bleedPdfUrl] = await Promise.all([
      getProjectPdfUrl(projectId),
      getProjectBleedPdfUrl(projectId),
    ])
    return NextResponse.json({ success: true, pdfUrl, bleedPdfUrl })
  } else {
    return NextResponse.json({ success: false, errors: result.errors }, { status: 422 })
  }
}

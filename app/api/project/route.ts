import { createServerSupabase } from '@/lib/supabase/server'
import { uploadProjectFile, copyTemplatePdf, getProjectPdfUrl } from '@/lib/latex/compiler'
import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getTemplate } from '@/lib/latex/templates'
import { readFileSync } from 'fs'

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

  // Create project record
  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      user_id: user.id,
      name: name || 'Untitled Book',
      template_id: tid,
      page_count: pageCount || 0,
    })
    .select()
    .single()

  if (error || !project) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create project' }, { status: 500 })
  }

  // Upload the single main.tex document
  await uploadProjectFile(project.id, 'main.tex', template.main)

  // Upload template images (if any) so they're available during compilation
  if (template.images?.length) {
    const supa = createServiceClient()
    console.log(`[Project] Uploading ${template.images.length} template images...`)
    for (const img of template.images) {
      try {
        const buffer = readFileSync(img.diskPath)
        const storagePath = `projects/${project.id}/${img.storagePath}`
        await supa.storage.from('projects').upload(storagePath, buffer, {
          contentType: 'image/png',
          upsert: true,
        })
      } catch (err) {
        console.warn(`[Project] Failed to upload ${img.storagePath}:`, err)
      }
    }
    console.log(`[Project] Template images uploaded`)
  }

  // Copy the pre-compiled template PDF so user sees it immediately
  const copied = await copyTemplatePdf(project.id, tid)
  if (copied) {
    const pdfUrl = await getProjectPdfUrl(project.id)
    return NextResponse.json({ ...project, status: 'ready', pdfUrl }, { status: 201 })
  }

  return NextResponse.json(project, { status: 201 })
}

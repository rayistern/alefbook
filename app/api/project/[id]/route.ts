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

  // Security fix (2026-07-03): verify ownership BEFORE touching storage.
  // Previously the storage removal ran for any authenticated user against
  // any project id — and the documented storage policy allows all
  // authenticated users to manage bucket files — so user A could wipe
  // user B's top-level project files (main.tex, the compiled PDF) by
  // DELETEing B's project id. The DB delete below was ownership-scoped and
  // failed silently, masking the damage.
  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id')
    .eq('id', params.id)
    .single()

  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Bugfix (2026-07-03): delete storage RECURSIVELY. Supabase's list() is
  // one level deep and remove() on a folder path is a no-op, so the old
  // single-level delete orphaned everything under images/, output/ and
  // snapshots/ forever (storage-cost leak). Walk the tree like the fork
  // route's copyStorageFolder does and remove actual file paths.
  const filePaths = await listStorageFilesRecursive(supabase, `projects/${params.id}`)
  if (filePaths.length > 0) {
    // remove() takes up to 1000 paths per call; chunk defensively.
    for (let i = 0; i < filePaths.length; i += 1000) {
      await supabase.storage
        .from('projects')
        .remove(filePaths.slice(i, i + 1000))
    }
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

/**
 * Recursively collect every file path under a storage prefix.
 *
 * Supabase Storage has no native recursive delete: list() returns one level,
 * folders are entries with `id === null`, and remove() silently ignores
 * folder paths. Mirrors the traversal shape used by copyStorageFolder in
 * app/api/project/[id]/fork/route.ts so both walk storage the same way.
 */
async function listStorageFilesRecursive(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  prefix: string
): Promise<string[]> {
  const { data: items } = await supabase.storage
    .from('projects')
    .list(prefix, { limit: 1000 })

  if (!items) return []

  const paths: string[] = []
  for (const item of items) {
    const fullPath = `${prefix}/${item.name}`
    if (item.id === null) {
      // Folder — recurse into it
      paths.push(...(await listStorageFilesRecursive(supabase, fullPath)))
    } else {
      paths.push(fullPath)
    }
  }
  return paths
}

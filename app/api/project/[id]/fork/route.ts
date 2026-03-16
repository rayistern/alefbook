import { createServerSupabase, createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createServiceClient()

  // Get the source project
  const { data: source } = await serviceClient
    .from('projects')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!source) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Must be public or owned by user
  if (!source.is_public && source.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Create the forked project
  const { data: fork, error } = await supabase
    .from('projects')
    .insert({
      user_id: user.id,
      name: `${source.name} (fork)`,
      description: source.description,
      page_count: source.page_count,
      template_id: source.template_id,
      forked_from: source.id,
      latex_engine: source.latex_engine,
    })
    .select()
    .single()

  if (error || !fork) {
    return NextResponse.json({ error: 'Failed to create fork' }, { status: 500 })
  }

  // Copy all storage files
  const sourcePath = `projects/${params.id}`
  await copyStorageFolder(serviceClient, sourcePath, `projects/${fork.id}`, sourcePath)

  // Increment fork count on source
  await serviceClient
    .from('projects')
    .update({ fork_count: (source.fork_count ?? 0) + 1 })
    .eq('id', params.id)

  return NextResponse.json(fork, { status: 201 })
}

async function copyStorageFolder(
  supabase: ReturnType<typeof createServiceClient>,
  sourcePath: string,
  destPath: string,
  rootSourcePath: string
): Promise<void> {
  const { data: items } = await supabase.storage
    .from('projects')
    .list(sourcePath)

  if (!items) return

  for (const item of items) {
    const fullSourcePath = `${sourcePath}/${item.name}`
    const relativePath = fullSourcePath.replace(rootSourcePath + '/', '')
    const fullDestPath = `${destPath}/${relativePath}`

    if (item.id === null) {
      // Folder
      await copyStorageFolder(supabase, fullSourcePath, destPath, rootSourcePath)
    } else {
      // File — download and re-upload
      const { data } = await supabase.storage
        .from('projects')
        .download(fullSourcePath)

      if (data) {
        const buffer = Buffer.from(await data.arrayBuffer())
        await supabase.storage
          .from('projects')
          .upload(fullDestPath, buffer, { upsert: true })
      }
    }
  }
}

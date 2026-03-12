import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/storage/supabase'
import { getOrCreateUserId } from '@/lib/storage/user'
import { NextRequest } from 'next/server'

// GET /api/project — list user's projects
// GET /api/project?id=xxx — get single project
export async function GET(req: NextRequest) {
  const { userId: clerkId } = await auth()
  if (!clerkId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient()
  const dbUserId = await getOrCreateUserId(clerkId)
  if (!dbUserId) return Response.json({ projects: [] })

  const projectId = req.nextUrl.searchParams.get('id')

  if (projectId) {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('user_id', dbUserId)
      .single()

    if (error || !data) {
      return Response.json({ error: 'Project not found' }, { status: 404 })
    }
    return Response.json(data)
  }

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, status, template_id, created_at, updated_at')
    .eq('user_id', dbUserId)
    .order('updated_at', { ascending: false })

  if (error) {
    return Response.json({ error: 'Failed to load projects' }, { status: 500 })
  }

  return Response.json({ projects: data })
}

// POST /api/project — create new project
export async function POST(req: Request) {
  const { userId: clerkId } = await auth()
  if (!clerkId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient()
  const dbUserId = await getOrCreateUserId(clerkId)
  if (!dbUserId) return Response.json({ error: 'User not found' }, { status: 404 })

  const body = await req.json()
  const name = body.name || 'My Haggadah'
  const templateId = body.template_id || 'haggadah-he-en-v1'

  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: dbUserId,
      name,
      template_id: templateId,
      status: 'draft',
      page_states: {},
      variant_options: body.variant_options || {},
    })
    .select()
    .single()

  if (error) {
    return Response.json({ error: 'Failed to create project' }, { status: 500 })
  }

  return Response.json(data, { status: 201 })
}

// PATCH /api/project — update project
export async function PATCH(req: Request) {
  const { userId: clerkId } = await auth()
  if (!clerkId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient()
  const dbUserId = await getOrCreateUserId(clerkId)
  if (!dbUserId) return Response.json({ error: 'User not found' }, { status: 404 })

  const body = await req.json()
  const { id, ...updates } = body

  if (!id) return Response.json({ error: 'Missing project id' }, { status: 400 })

  // Verify ownership
  const { data: existing } = await supabase
    .from('projects')
    .select('user_id')
    .eq('id', id)
    .single()

  if (!existing || existing.user_id !== dbUserId) {
    return Response.json({ error: 'Project not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('projects')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return Response.json({ error: 'Failed to update project' }, { status: 500 })
  }

  return Response.json(data)
}

// DELETE /api/project — delete project
export async function DELETE(req: NextRequest) {
  const { userId: clerkId } = await auth()
  if (!clerkId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient()
  const dbUserId = await getOrCreateUserId(clerkId)
  if (!dbUserId) return Response.json({ error: 'User not found' }, { status: 404 })

  const projectId = req.nextUrl.searchParams.get('id')
  if (!projectId) return Response.json({ error: 'Missing project id' }, { status: 400 })

  // Verify ownership
  const { data: existing } = await supabase
    .from('projects')
    .select('user_id')
    .eq('id', projectId)
    .single()

  if (!existing || existing.user_id !== dbUserId) {
    return Response.json({ error: 'Project not found' }, { status: 404 })
  }

  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId)

  if (error) {
    return Response.json({ error: 'Failed to delete project' }, { status: 500 })
  }

  return Response.json({ ok: true })
}

import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/storage/supabase'
import { getOrCreateUserId } from '@/lib/storage/user'
import { loadPageHTML } from '@/lib/templates/loader'
import { getPageStates } from '@/lib/templates/page-state'
import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  console.log('[PageHTML] GET /api/page-html called:', req.nextUrl.searchParams.toString())
  const { userId: clerkId } = await auth()
  if (!clerkId) {
    console.log('[PageHTML] Unauthorized')
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const projectId = req.nextUrl.searchParams.get('projectId')
  const pageNum = Number(req.nextUrl.searchParams.get('page'))

  if (!projectId || !pageNum) {
    return Response.json({ error: 'Missing projectId or page' }, { status: 400 })
  }

  const supabase = createClient()
  const dbUserId = await getOrCreateUserId(clerkId)
  if (!dbUserId) return Response.json({ error: 'User not found' }, { status: 404 })

  const { data: project } = await supabase
    .from('projects')
    .select('user_id')
    .eq('id', projectId)
    .eq('user_id', dbUserId)
    .single()

  if (!project) {
    console.log('[PageHTML] Project not found')
    return Response.json({ error: 'Project not found' }, { status: 404 })
  }

  const projectPageStates = await getPageStates(projectId)
  const html = loadPageHTML(pageNum, projectPageStates[String(pageNum)])
  console.log(`[PageHTML] Page ${pageNum}: HTML loaded, length=${html.length}`)

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, max-age=60',
    },
  })
}

import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/storage/supabase'
import { getOrCreateUserId } from '@/lib/storage/user'
import { loadPageHTML } from '@/lib/templates/loader'
import { getPageStates } from '@/lib/templates/page-state'
import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const { userId: clerkId } = await auth()
  if (!clerkId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

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
    .select('user_id, format')
    .eq('id', projectId)
    .eq('user_id', dbUserId)
    .single()

  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 })

  // LaTeX projects don't serve HTML pages — redirect to render endpoint
  if (project.format === 'latex') {
    // Return a simple HTML page that shows a message to use renders instead
    const placeholderHtml = `<!DOCTYPE html><html><body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;color:#666;"><p>LaTeX project — use rendered preview</p></body></html>`
    return new Response(placeholderHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, max-age=60',
      },
    })
  }

  const projectPageStates = await getPageStates(projectId)
  const html = loadPageHTML(pageNum, projectPageStates[String(pageNum)])

  // No spinner — iframe has sandbox="allow-same-origin" (no allow-scripts),
  // so the spinner script can't run and would block the page forever.
  // font-display: swap in the CSS handles font loading gracefully.
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, max-age=60',
    },
  })
}

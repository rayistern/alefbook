import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/storage/supabase'
import { renderPageToImage } from '@/lib/rendering/puppeteer'
import { loadPageHTML, loadTemplateMeta } from '@/lib/templates/loader'
import { getPageStates } from '@/lib/templates/page-state'
import { createHash } from 'crypto'

export async function POST(req: Request) {
  const { userId: clerkId } = await auth()
  if (!clerkId) return new Response('Unauthorized', { status: 401 })

  const body = await req.json()
  const { projectId, pageNumbers } = body as {
    projectId: string
    pageNumbers: number[]
  }

  if (!projectId || !pageNumbers?.length) {
    return new Response('Missing required fields', { status: 400 })
  }

  // Verify project ownership
  const supabase = createClient()
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_id', clerkId)
    .single()

  if (!user) return new Response('User not found', { status: 404 })

  const { data: project } = await supabase
    .from('projects')
    .select('user_id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!project) return new Response('Project not found', { status: 404 })

  const projectPageStates = await getPageStates(projectId)
  const renderUrls: Record<number, string> = {}

  for (const pageNum of pageNumbers) {
    const html = loadPageHTML(pageNum, projectPageStates[String(pageNum)])
    const htmlHash = createHash('md5').update(html).digest('hex')

    // Check render cache
    const { data: cached } = await supabase
      .from('renders')
      .select('image_path')
      .eq('project_id', projectId)
      .eq('html_hash', htmlHash)
      .single()

    if (cached) {
      const { data: urlData } = supabase.storage
        .from('renders')
        .getPublicUrl(cached.image_path)
      renderUrls[pageNum] = urlData.publicUrl
      continue
    }

    // Render the page
    const imageBuffer = await renderPageToImage(html)
    const imagePath = `projects/${projectId}/renders/page-${pageNum}.png`

    // Upload to storage
    await supabase.storage
      .from('renders')
      .upload(imagePath, imageBuffer, {
        contentType: 'image/png',
        upsert: true,
      })

    // Cache the render
    await supabase.from('renders').upsert(
      {
        project_id: projectId,
        page_number: pageNum,
        html_hash: htmlHash,
        image_path: imagePath,
      },
      { onConflict: 'project_id,html_hash' }
    )

    const { data: urlData } = supabase.storage
      .from('renders')
      .getPublicUrl(imagePath)
    renderUrls[pageNum] = urlData.publicUrl
  }

  return Response.json({ renderUrls })
}

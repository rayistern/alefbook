import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/storage/supabase'
import { getOrCreateUserId } from '@/lib/storage/user'
import { renderPageToImage } from '@/lib/rendering/puppeteer'
import { loadPageHTML } from '@/lib/templates/loader'
import { getPageStates } from '@/lib/templates/page-state'
import { createHash } from 'crypto'

export async function POST(req: Request) {
  console.log('[Render] POST /api/render called')
  const { userId: clerkId } = await auth()
  if (!clerkId) {
    console.log('[Render] Unauthorized - no clerkId')
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { projectId, pageNumbers } = body as {
    projectId: string
    pageNumbers: number[]
  }
  console.log('[Render] Request for project:', projectId, 'pages:', pageNumbers)

  if (!projectId || !pageNumbers?.length) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Verify project ownership
  const supabase = createClient()
  const dbUserId = await getOrCreateUserId(clerkId)

  if (!dbUserId) {
    console.log('[Render] User not found in DB')
    return Response.json({ error: 'User not found' }, { status: 404 })
  }

  const { data: project } = await supabase
    .from('projects')
    .select('user_id')
    .eq('id', projectId)
    .eq('user_id', dbUserId)
    .single()

  if (!project) {
    console.log('[Render] Project not found or not owned by user')
    return Response.json({ error: 'Project not found' }, { status: 404 })
  }

  const projectPageStates = await getPageStates(projectId)
  console.log('[Render] Page states loaded, keys:', Object.keys(projectPageStates))
  const renderUrls: Record<number, string> = {}

  for (const pageNum of pageNumbers) {
    try {
      const html = loadPageHTML(pageNum, projectPageStates[String(pageNum)])
      console.log(`[Render] Page ${pageNum}: HTML loaded, length=${html.length}`)
      const htmlHash = createHash('md5').update(html).digest('hex')

      // Check render cache
      const { data: cached, error: cacheError } = await supabase
        .from('renders')
        .select('image_path')
        .eq('project_id', projectId)
        .eq('html_hash', htmlHash)
        .single()

      console.log(`[Render] Page ${pageNum}: cache lookup - found=${!!cached}, error=${cacheError?.message}`)

      if (cached) {
        const { data: urlData } = supabase.storage
          .from('renders')
          .getPublicUrl(cached.image_path)
        renderUrls[pageNum] = urlData.publicUrl
        console.log(`[Render] Page ${pageNum}: using cached render`)
        continue
      }

      // Render the page
      console.log(`[Render] Page ${pageNum}: starting Puppeteer render...`)
      const imageBuffer = await renderPageToImage(html)
      console.log(`[Render] Page ${pageNum}: rendered, buffer size=${imageBuffer.length}`)
      const imagePath = `projects/${projectId}/renders/page-${pageNum}.png`

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('renders')
        .upload(imagePath, imageBuffer, {
          contentType: 'image/png',
          upsert: true,
        })

      if (uploadError) {
        console.error(`[Render] Page ${pageNum}: storage upload FAILED:`, uploadError.message)
        continue
      }
      console.log(`[Render] Page ${pageNum}: uploaded to storage`)

      // Cache the render
      const { error: upsertError } = await supabase.from('renders').upsert(
        {
          project_id: projectId,
          page_number: pageNum,
          html_hash: htmlHash,
          image_path: imagePath,
        },
        { onConflict: 'project_id,html_hash' }
      )
      console.log(`[Render] Page ${pageNum}: cache upsert error=${upsertError?.message}`)

      const { data: urlData } = supabase.storage
        .from('renders')
        .getPublicUrl(imagePath)
      renderUrls[pageNum] = urlData.publicUrl
      console.log(`[Render] Page ${pageNum}: done, url=${urlData.publicUrl}`)
    } catch (err) {
      console.error(`[Render] Page ${pageNum}: EXCEPTION:`, err)
    }
  }

  console.log('[Render] Returning renderUrls with', Object.keys(renderUrls).length, 'entries')
  return Response.json({ renderUrls })
}

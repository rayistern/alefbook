import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/storage/supabase'
import { getOrCreateUserId } from '@/lib/storage/user'
import { renderPageToImage } from '@/lib/rendering/puppeteer'
import { renderLatexToPageImages } from '@/lib/rendering/latex'
import { loadPageHTML, loadLatexTemplateSource } from '@/lib/templates/loader'
import { getPageStates, getLatexSource } from '@/lib/templates/page-state'
import { createHash } from 'crypto'

export async function POST(req: Request) {
  const { userId: clerkId } = await auth()
  if (!clerkId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { projectId, pageNumbers } = body as {
    projectId: string
    pageNumbers: number[]
  }

  if (!projectId || !pageNumbers?.length) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Verify project ownership and get format
  const supabase = createClient()
  const dbUserId = await getOrCreateUserId(clerkId)

  if (!dbUserId) return Response.json({ error: 'User not found' }, { status: 404 })

  const { data: project } = await supabase
    .from('projects')
    .select('user_id, format, template_id')
    .eq('id', projectId)
    .eq('user_id', dbUserId)
    .single()

  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 })

  const projectFormat = (project.format as 'html' | 'latex') || 'html'

  // LaTeX projects: compile the whole book and extract requested pages
  if (projectFormat === 'latex') {
    return renderLatexPages(supabase, projectId, project.template_id, pageNumbers)
  }

  // HTML projects: render per-page
  const projectPageStates = await getPageStates(projectId)
  const renderUrls: Record<number, string> = {}

  for (const pageNum of pageNumbers) {
    try {
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
        const { data: signedData, error: signError } = await supabase.storage
          .from('renders')
          .createSignedUrl(cached.image_path, 3600)
        if (!signError && signedData?.signedUrl) {
          renderUrls[pageNum] = signedData.signedUrl
        }
        continue
      }

      // Render the page
      const imageBuffer = await renderPageToImage(html)
      const imagePath = `projects/${projectId}/renders/page-${pageNum}.png`

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('renders')
        .upload(imagePath, imageBuffer, {
          contentType: 'image/png',
          upsert: true,
        })

      if (uploadError) {
        console.error(`Storage upload failed for page ${pageNum}:`, uploadError.message)
        continue
      }

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

      const { data: signedData, error: signError } = await supabase.storage
        .from('renders')
        .createSignedUrl(imagePath, 3600)
      if (!signError && signedData?.signedUrl) {
        renderUrls[pageNum] = signedData.signedUrl
      }
    } catch (err) {
      console.error(`Failed to render page ${pageNum}:`, err)
    }
  }

  return Response.json({ renderUrls })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderLatexPages(supabase: any, projectId: string, templateId: string, pageNumbers: number[]) {
  try {
    const latexSource = (await getLatexSource(projectId)) ?? loadLatexTemplateSource(templateId)
    const sourceHash = createHash('md5').update(latexSource).digest('hex')

    // Check if we have a cached render for this source
    const { data: cached } = await supabase
      .from('renders')
      .select('image_path')
      .eq('project_id', projectId)
      .eq('html_hash', sourceHash)
      .single()

    const renderUrls: Record<number, string> = {}

    if (cached) {
      // Source hasn't changed — serve cached PNGs for requested pages
      for (const pageNum of pageNumbers) {
        const imagePath = `projects/${projectId}/renders/page-${pageNum}.png`
        const { data: signedData, error: signError } = await supabase.storage
          .from('renders')
          .createSignedUrl(imagePath, 3600)
        if (!signError && signedData?.signedUrl) {
          renderUrls[pageNum] = signedData.signedUrl
        }
      }
      return Response.json({ renderUrls })
    }

    // Compile and render all pages
    const allPages = await renderLatexToPageImages(latexSource)

    // Upload all pages (not just requested ones — we compiled the whole book)
    const pageEntries = Array.from(allPages.entries())
    for (const [pageNum, pngBuffer] of pageEntries) {
      const imagePath = `projects/${projectId}/renders/page-${pageNum}.png`
      await supabase.storage
        .from('renders')
        .upload(imagePath, pngBuffer, { contentType: 'image/png', upsert: true })
    }

    // Cache with source hash (use page 1 as the cache key entry)
    await supabase.from('renders').upsert(
      {
        project_id: projectId,
        page_number: 1,
        html_hash: sourceHash,
        image_path: `projects/${projectId}/renders/page-1.png`,
      },
      { onConflict: 'project_id,html_hash' }
    )

    // Return signed URLs for requested pages
    for (const pageNum of pageNumbers) {
      const imagePath = `projects/${projectId}/renders/page-${pageNum}.png`
      const { data: signedData, error: signError } = await supabase.storage
        .from('renders')
        .createSignedUrl(imagePath, 3600)
      if (!signError && signedData?.signedUrl) {
        renderUrls[pageNum] = signedData.signedUrl
      }
    }

    return Response.json({ renderUrls })
  } catch (err) {
    console.error('[Render/LaTeX] Compilation failed:', err)
    return Response.json({ error: 'LaTeX compilation failed', renderUrls: {} }, { status: 500 })
  }
}

import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/storage/supabase'
import { getOrCreateUserId } from '@/lib/storage/user'
import { checkLimit } from '@/lib/rate-limit/upstash'
import { compileToPDF } from '@/lib/rendering/pdf'
import { loadAllPageStates } from '@/lib/templates/loader'
import { getPageStates } from '@/lib/templates/page-state'

export async function POST(req: Request) {
  const { userId: clerkId } = await auth()
  if (!clerkId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limit check
  const limitResult = await checkLimit('pdfExports', clerkId)
  if (!limitResult.allowed) {
    return Response.json(
      {
        error: `You've made a lot of PDF exports! Your limit resets in ${Math.ceil((limitResult.retryAfterSeconds ?? 60) / 60)} minutes.`,
      },
      { status: 429 }
    )
  }

  const body = await req.json()
  const { projectId } = body

  if (!projectId) return Response.json({ error: 'Missing projectId' }, { status: 400 })

  // Verify project ownership
  const supabase = createClient()
  const dbUserId = await getOrCreateUserId(clerkId)

  if (!dbUserId) return Response.json({ error: 'User not found' }, { status: 404 })

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', dbUserId)
    .single()

  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 })

  try {
    console.log('[PDF API] Starting PDF generation for project:', projectId)

    // Load all page states
    const projectPageStates = await getPageStates(projectId)
    const pageStates = loadAllPageStates(projectPageStates)
    console.log('[PDF API] Loaded page states:', Object.keys(pageStates).length, 'pages')

    // Generate PDF
    const pdfBuffer = await compileToPDF(pageStates)
    console.log('[PDF API] PDF generated:', (pdfBuffer.length / 1024).toFixed(1), 'KB')

    // Upload to Supabase Storage
    const pdfPath = `projects/${projectId}/exports/haggadah-${Date.now()}.pdf`
    const { error: uploadError } = await supabase.storage
      .from('exports')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (uploadError) {
      throw new Error(`PDF upload failed: ${uploadError.message}`)
    }

    // Create signed URL (valid 24 hours)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('exports')
      .createSignedUrl(pdfPath, 24 * 60 * 60) // 24 hours

    if (signedUrlError || !signedUrlData) {
      throw new Error('Failed to create signed URL')
    }

    return Response.json({
      pdfUrl: signedUrlData.signedUrl,
      path: pdfPath,
    })
  } catch (error) {
    console.error('[PDF API] Generation failed:', error instanceof Error ? { message: error.message, stack: error.stack } : error)
    return Response.json({ error: 'PDF generation failed' }, { status: 500 })
  }
}

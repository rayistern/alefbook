import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/storage/supabase'
import { checkLimit } from '@/lib/rate-limit/upstash'
import { compileToPDF } from '@/lib/rendering/pdf'
import { loadAllPageStates } from '@/lib/templates/loader'
import { getPageStates } from '@/lib/templates/page-state'

export async function POST(req: Request) {
  const { userId: clerkId } = await auth()
  if (!clerkId) return new Response('Unauthorized', { status: 401 })

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

  if (!projectId) return new Response('Missing projectId', { status: 400 })

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
    .select('*')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!project) return new Response('Project not found', { status: 404 })

  try {
    // Load all page states
    const projectPageStates = await getPageStates(projectId)
    const pageStates = loadAllPageStates(projectPageStates)

    // Generate PDF
    const pdfBuffer = await compileToPDF(pageStates)

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
    console.error('PDF generation failed:', error)
    return new Response('PDF generation failed', { status: 500 })
  }
}

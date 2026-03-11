import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/storage/supabase'
import { processAndUploadImage } from '@/lib/storage/uploads'
import { checkLimit } from '@/lib/rate-limit/upstash'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif']

export async function POST(req: Request) {
  const { userId: clerkId } = await auth()
  if (!clerkId) return new Response('Unauthorized', { status: 401 })

  // Rate limit check
  const limitResult = await checkLimit('uploads', clerkId)
  if (!limitResult.allowed) {
    return Response.json(
      {
        error: `You've made a lot of uploads! Your limit resets in ${Math.ceil((limitResult.retryAfterSeconds ?? 60) / 60)} minutes.`,
      },
      { status: 429 }
    )
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const projectId = formData.get('projectId') as string | null

  if (!file) return new Response('No file uploaded', { status: 400 })
  if (!projectId) return new Response('Missing projectId', { status: 400 })

  // Validate file type
  if (!ALLOWED_TYPES.includes(file.type)) {
    return Response.json(
      { error: 'File type not supported. Please upload JPG, PNG, or HEIC.' },
      { status: 400 }
    )
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      { error: 'File is too large. Maximum size is 20MB.' },
      { status: 400 }
    )
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
    .single()

  if (!project || project.user_id !== user.id) {
    return new Response('Project not found', { status: 404 })
  }

  try {
    const upload = await processAndUploadImage(projectId, file)
    return Response.json(upload, { status: 201 })
  } catch (error) {
    console.error('Upload failed:', error)
    return new Response('Upload processing failed', { status: 500 })
  }
}

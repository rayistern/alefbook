import sharp from 'sharp'
import { createClient } from './supabase'
import { randomUUID } from 'crypto'

export interface Upload {
  id: string
  project_id: string
  slot_id: string | null
  filename: string
  storage_path_display: string
  storage_path_print: string
  width: number | null
  height: number | null
  created_at: string
}

export async function processAndUploadImage(
  projectId: string,
  file: File
): Promise<Upload> {
  const supabase = createClient()
  const uploadId = randomUUID()
  const buffer = Buffer.from(await file.arrayBuffer())

  // Get image metadata
  const metadata = await sharp(buffer).metadata()

  // Create display version (max 800x800, quality 85)
  const displayBuffer = await sharp(buffer)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()

  // Create print version (full resolution, quality 95)
  const printBuffer = await sharp(buffer)
    .jpeg({ quality: 95 })
    .toBuffer()

  const displayPath = `projects/${projectId}/uploads/${uploadId}-display.jpg`
  const printPath = `projects/${projectId}/uploads/${uploadId}-print.jpg`

  // Upload both versions to Supabase Storage
  const [displayResult, printResult] = await Promise.all([
    supabase.storage.from('uploads').upload(displayPath, displayBuffer, {
      contentType: 'image/jpeg',
    }),
    supabase.storage.from('uploads').upload(printPath, printBuffer, {
      contentType: 'image/jpeg',
    }),
  ])

  if (displayResult.error) throw new Error(`Display upload failed: ${displayResult.error.message}`)
  if (printResult.error) throw new Error(`Print upload failed: ${printResult.error.message}`)

  // Insert record into uploads table
  const { data, error } = await supabase
    .from('uploads')
    .insert({
      id: uploadId,
      project_id: projectId,
      filename: file.name,
      storage_path_display: displayPath,
      storage_path_print: printPath,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to save upload record: ${error.message}`)
  return data as Upload
}

export async function getProjectUploads(projectId: string): Promise<Upload[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('uploads')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to load uploads: ${error.message}`)
  return (data ?? []) as Upload[]
}

export async function getUploadDisplayUrl(storagePath: string): Promise<string> {
  const supabase = createClient()
  const { data } = supabase.storage.from('uploads').getPublicUrl(storagePath)
  return data.publicUrl
}

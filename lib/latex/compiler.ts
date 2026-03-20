import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { createServiceClient } from '@/lib/supabase/server'
import { getPdfPageCount } from './pdf-to-image'

export interface CompileResult {
  success: boolean
  pdfPath?: string
  log?: string
  errors?: string[]
}

/**
 * Download all project LaTeX files + images from Supabase Storage
 * into a temp directory, compile with latexmk, upload the PDF back.
 *
 * If `mainTexContent` is provided, it is written directly to main.tex
 * instead of relying on the Supabase download (avoids race conditions
 * with eventual consistency after an upsert).
 */
export async function compileProject(
  projectId: string,
  mainTexContent?: string
): Promise<CompileResult> {
  const supabase = createServiceClient()
  const tmpDir = path.join(os.tmpdir(), `alefbook-${projectId}-${Date.now()}`)

  try {
    await fs.mkdir(tmpDir, { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'pages'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'images'), { recursive: true })

    // List and download all project files from storage
    const storagePath = `projects/${projectId}`
    await downloadFolder(supabase, storagePath, tmpDir, storagePath)

    // Overwrite main.tex with the in-memory version if provided
    // (avoids Supabase storage eventual consistency issues)
    if (mainTexContent) {
      await fs.writeFile(path.join(tmpDir, 'main.tex'), mainTexContent, 'utf-8')
    }

    // Log what files are in the working directory (especially images)
    try {
      const imgDir = path.join(tmpDir, 'images')
      const imgFiles = await fs.readdir(imgDir).catch(() => [] as string[])
      console.log(`[Compiler] Images in workdir: ${imgFiles.length} files: ${imgFiles.join(', ')}`)

      // Check if main.tex has any \includegraphics calls
      const mainTex = await fs.readFile(path.join(tmpDir, 'main.tex'), 'utf-8')
      const includeMatches = mainTex.match(/\\includegraphics[^}]*\{[^}]+\}/g) || []
      console.log(`[Compiler] \\includegraphics calls in main.tex: ${includeMatches.join(' | ') || 'none'}`)
    } catch (e) {
      console.warn('[Compiler] Could not log working dir contents:', e)
    }

    // Template images (korech1a.png, etc.) are found via TEXINPUTS which
    // includes /app/newImages_whitebg// etc. No need to copy them into
    // the work dir — and doing so would overwrite user-uploaded images.

    // Compile
    const result = await runLatexmk(tmpDir)

    console.log(`[Compiler] Compilation ${result.success ? 'SUCCEEDED' : 'FAILED'}${result.errors?.length ? ': ' + result.errors.join('; ') : ''}`)

    // Compress only if the PDF exceeds Supabase's 50MB upload limit
    if (result.success) {
      await compressPdfIfNeeded(path.join(tmpDir, 'main.pdf'))
    }

    if (result.success) {
      // Upload compiled PDF to storage
      const pdfFile = await fs.readFile(path.join(tmpDir, 'main.pdf'))
      const pdfStoragePath = `projects/${projectId}/output/main.pdf`

      const { error: uploadError } = await supabase.storage
        .from('projects')
        .upload(pdfStoragePath, pdfFile, {
          contentType: 'application/pdf',
          upsert: true,
        })

      if (uploadError) {
        console.error('[Compiler] PDF upload error:', uploadError)
        return { success: false, errors: [`PDF upload failed: ${uploadError.message}`] }
      }

      // Count pages in the compiled PDF
      let pageCount: number | undefined
      try {
        pageCount = await getPdfPageCount(pdfFile)
      } catch {
        // non-fatal — page_count just won't be updated
      }

      // Update project status (and page_count if we got it)
      await supabase
        .from('projects')
        .update({
          status: 'ready',
          pdf_path: pdfStoragePath,
          compile_error: null,
          ...(pageCount ? { page_count: pageCount } : {}),
        })
        .eq('id', projectId)

      return { success: true, pdfPath: pdfStoragePath, log: result.log }
    } else {
      // Update project with error
      await supabase
        .from('projects')
        .update({
          status: 'error',
          compile_error: result.errors?.join('\n') ?? 'Unknown compilation error',
        })
        .eq('id', projectId)

      return result
    }
  } finally {
    // Clean up temp directory
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function downloadFolder(
  supabase: ReturnType<typeof createServiceClient>,
  storagePath: string,
  localDir: string,
  rootStoragePath: string
): Promise<void> {
  const { data: files, error } = await supabase.storage
    .from('projects')
    .list(storagePath)

  if (error || !files) return

  for (const file of files) {
    const fullStoragePath = `${storagePath}/${file.name}`
    const relativePath = fullStoragePath.replace(rootStoragePath + '/', '')
    const localPath = path.join(localDir, relativePath)

    if (file.id === null) {
      // It's a folder
      await fs.mkdir(localPath, { recursive: true })
      await downloadFolder(supabase, fullStoragePath, localDir, rootStoragePath)
    } else {
      // It's a file — skip output folder
      if (relativePath.startsWith('output/')) continue

      await fs.mkdir(path.dirname(localPath), { recursive: true })
      const { data, error: dlError } = await supabase.storage
        .from('projects')
        .download(fullStoragePath)

      if (dlError || !data) {
        console.warn(`[Compiler] Failed to download ${fullStoragePath}:`, dlError)
        continue
      }

      const buffer = Buffer.from(await data.arrayBuffer())
      await fs.writeFile(localPath, buffer)
    }
  }
}

function runLatexmk(workDir: string): Promise<CompileResult> {
  // Tell TeX where to find template images (bundled in Docker at /app/)
  const appDir = process.cwd()
  const texInputs = [
    workDir + '//',  // recursive so user images in subdirs are found first
    path.join(appDir, 'templates', 'haggadah-images') + '//',
    path.join(appDir, 'templates', 'haggadah-kids-images') + '//',
    '', // trailing colon = include default search paths
  ].join(':')

  console.log(`[Compiler] TEXINPUTS=${texInputs}`)
  console.log(`[Compiler] workDir=${workDir}`)

  return new Promise((resolve) => {
    execFile(
      'latexmk',
      [
        '-xelatex',
        '-interaction=nonstopmode',
        '-halt-on-error',
        '-output-directory=' + workDir,
        'main.tex',
      ],
      {
        cwd: workDir,
        timeout: 120_000, // 2 minutes max
        maxBuffer: 10 * 1024 * 1024, // 10MB log buffer
        env: { ...process.env, TEXINPUTS: texInputs },
      },
      (error, stdout, stderr) => {
        const log = stdout + '\n' + stderr

        if (error) {
          const errors = parseLatexErrors(log)
          console.error('[Compiler] LaTeX compilation failed. Errors:', errors)
          console.error('[Compiler] Log (last 3000 chars):', log.slice(-3000))
          resolve({
            success: false,
            log,
            errors: errors.length > 0 ? errors : ['Compilation failed. Check the log for details.'],
          })
        } else {
          resolve({ success: true, log })
        }
      }
    )
  })
}

/**
 * Compress a PDF with ghostscript if it exceeds a configurable threshold.
 * Set PDF_COMPRESS_THRESHOLD_MB env var to enable (e.g. "50" for 50MB).
 * Defaults to 0 (disabled).
 * Uses /prepress quality (300 DPI, colour-accurate) so output is still print-ready.
 */
async function compressPdfIfNeeded(pdfPath: string): Promise<void> {
  const thresholdMB = parseInt(process.env.PDF_COMPRESS_THRESHOLD_MB || '0', 10)
  if (thresholdMB <= 0) return // compression disabled

  const compressedPath = pdfPath.replace('.pdf', '-compressed.pdf')

  try {
    const size = (await fs.stat(pdfPath)).size
    const sizeMB = size / 1024 / 1024
    console.log(`[Compiler] PDF size: ${sizeMB.toFixed(1)}MB`)

    if (sizeMB < thresholdMB) return

    console.log(`[Compiler] PDF exceeds ${thresholdMB}MB threshold, compressing (prepress/300dpi)...`)

    await new Promise<void>((resolve, reject) => {
      execFile(
        'gs',
        [
          '-sDEVICE=pdfwrite',
          '-dCompatibilityLevel=1.4',
          '-dPDFSETTINGS=/prepress', // 300 DPI, highest quality
          '-dNOPAUSE', '-dQUIET', '-dBATCH',
          `-sOutputFile=${compressedPath}`,
          pdfPath,
        ],
        { timeout: 120_000, maxBuffer: 5 * 1024 * 1024 },
        (error) => (error ? reject(error) : resolve())
      )
    })

    const compressedSize = (await fs.stat(compressedPath)).size
    console.log(`[Compiler] Compressed: ${(compressedSize / 1024 / 1024).toFixed(1)}MB (${Math.round((1 - compressedSize / size) * 100)}% reduction)`)

    if (compressedSize < size) {
      await fs.rename(compressedPath, pdfPath)
    } else {
      await fs.unlink(compressedPath).catch(() => {})
    }
  } catch (err) {
    console.warn('[Compiler] PDF compression failed, uploading uncompressed:', err)
    await fs.unlink(compressedPath).catch(() => {})
  }
}

function parseLatexErrors(log: string): string[] {
  const errors: string[] = []
  const lines = log.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // LaTeX errors start with !
    if (line.startsWith('!')) {
      let errorMsg = line
      // Grab next few lines for context
      for (let j = 1; j <= 3 && i + j < lines.length; j++) {
        errorMsg += '\n' + lines[i + j]
      }
      errors.push(errorMsg.trim())
    }
  }

  // Also catch xdvipdfmx failures (XDV → PDF conversion)
  // These don't start with ! but appear as "xdvipdfmx:fatal:" or latexmk error summaries
  if (errors.length === 0) {
    if (log.includes('xdvipdfmx:fatal:') || log.includes('xdvipdfmx:warning:')) {
      const xdvLines = lines.filter(l => l.includes('xdvipdfmx:'))
      errors.push('PDF conversion (xdvipdfmx) failed: ' + xdvLines.join('; ').slice(0, 500))
    }
    // Catch generic latexmk failure when xelatex succeeded but xdvipdfmx didn't
    if (log.includes('gave return code') && !log.includes('Output written on main.pdf')) {
      const returnCodeLine = lines.find(l => l.includes('gave return code'))
      if (returnCodeLine) errors.push(returnCodeLine.trim())
    }
  }

  return errors
}

/**
 * Get a signed URL for a project's compiled PDF
 */
export async function getProjectPdfUrl(projectId: string): Promise<string | null> {
  const supabase = createServiceClient()

  const { data: project } = await supabase
    .from('projects')
    .select('pdf_path')
    .eq('id', projectId)
    .single()

  if (!project?.pdf_path) return null

  const { data } = await supabase.storage
    .from('projects')
    .createSignedUrl(project.pdf_path, 3600) // 1 hour

  return data?.signedUrl ?? null
}

/**
 * Upload a LaTeX source file to a project's storage
 */
export async function uploadProjectFile(
  projectId: string,
  filePath: string,
  content: string
): Promise<void> {
  const supabase = createServiceClient()
  const storagePath = `projects/${projectId}/${filePath}`

  const { error } = await supabase.storage
    .from('projects')
    .upload(storagePath, Buffer.from(content, 'utf-8'), {
      contentType: 'text/plain',
      upsert: true,
    })

  if (error) {
    throw new Error(`Failed to upload ${filePath}: ${error.message}`)
  }
}

/**
 * Read a LaTeX source file from project storage
 */
export async function readProjectFile(
  projectId: string,
  filePath: string
): Promise<string | null> {
  const supabase = createServiceClient()
  const storagePath = `projects/${projectId}/${filePath}`

  const { data, error } = await supabase.storage
    .from('projects')
    .download(storagePath)

  if (error || !data) return null
  return await data.text()
}

/**
 * Copy a cached template PDF to a project's output folder.
 * Returns true if a cached PDF existed and was copied successfully.
 */
export async function copyTemplatePdf(
  projectId: string,
  templateId: string
): Promise<boolean> {
  const supabase = createServiceClient()
  const sourcePath = `templates/${templateId}/main.pdf`

  // Download the cached template PDF
  const { data, error } = await supabase.storage
    .from('projects')
    .download(sourcePath)

  if (error || !data) {
    console.warn(`[Compiler] No cached PDF for template "${templateId}": ${error?.message ?? 'not found'}`)
    return false
  }

  const buffer = Buffer.from(await data.arrayBuffer())
  const destPath = `projects/${projectId}/output/main.pdf`

  const { error: uploadError } = await supabase.storage
    .from('projects')
    .upload(destPath, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    })

  if (uploadError) return false

  // Count pages in the template PDF
  let pageCount: number | undefined
  try {
    pageCount = await getPdfPageCount(buffer)
  } catch {
    // non-fatal
  }

  // Mark project as ready
  await supabase
    .from('projects')
    .update({
      status: 'ready',
      pdf_path: destPath,
      compile_error: null,
      ...(pageCount ? { page_count: pageCount } : {}),
    })
    .eq('id', projectId)

  return true
}

/**
 * Upload a binary file (image) to project storage
 */
export async function uploadProjectImage(
  projectId: string,
  filename: string,
  buffer: Buffer,
  mimeType: string = 'image/png'
): Promise<string> {
  const supabase = createServiceClient()
  const storagePath = `projects/${projectId}/images/${filename}`

  const { error } = await supabase.storage
    .from('projects')
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: true,
    })

  if (error) {
    throw new Error(`Failed to upload image ${filename}: ${error.message}`)
  }

  return storagePath
}

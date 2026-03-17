import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promises as fs, readFileSync } from 'fs'
import path from 'path'
import os from 'os'
import { createServiceClient } from '@/lib/supabase/server'
import { getTemplate } from '@/lib/latex/templates'

export const maxDuration = 300

const TEMPLATES = ['blank', 'hebrew-english', 'haggadah']
const DEFAULT_PAGE_COUNT = 10

/**
 * POST /api/admin/compile-templates
 *
 * Compile each template and cache the resulting PDF in Supabase Storage
 * under templates/{templateId}/main.pdf. These cached PDFs are copied
 * to new projects on creation so users see a PDF immediately.
 *
 * Protected by ADMIN_SECRET env var (pass as ?secret=... query param).
 */
export async function POST(request: NextRequest) {
  // Simple auth check
  const secret = request.nextUrl.searchParams.get('secret')
  if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const results: Record<string, string> = {}

  for (const templateId of TEMPLATES) {
    const tmpDir = path.join(os.tmpdir(), `alefbook-template-${templateId}-${Date.now()}`)
    console.log(`[Admin] Compiling template: ${templateId}`)

    try {
      await fs.mkdir(tmpDir, { recursive: true })
      await fs.mkdir(path.join(tmpDir, 'images'), { recursive: true })

      const template = getTemplate(templateId, DEFAULT_PAGE_COUNT)
      await fs.writeFile(path.join(tmpDir, 'main.tex'), template.main, 'utf-8')

      // Copy template images into the temp directory
      if (template.images?.length) {
        for (const img of template.images) {
          const destPath = path.join(tmpDir, img.storagePath)
          await fs.mkdir(path.dirname(destPath), { recursive: true })
          await fs.copyFile(img.diskPath, destPath)
        }
        console.log(`[Admin] Copied ${template.images.length} images for ${templateId}`)
      }

      const compileResult = await runLatexmk(tmpDir)

      if (compileResult.success) {
        const pdfBuffer = await fs.readFile(path.join(tmpDir, 'main.pdf'))
        const storagePath = `templates/${templateId}/main.pdf`

        const { error } = await supabase.storage
          .from('projects')
          .upload(storagePath, pdfBuffer, {
            contentType: 'application/pdf',
            upsert: true,
          })

        if (error) {
          results[templateId] = `upload failed: ${error.message}`
          console.error(`[Admin] Upload failed for ${templateId}:`, error.message)
        } else {
          results[templateId] = 'ok'
          console.log(`[Admin] Template ${templateId} compiled and cached successfully`)
        }
      } else {
        results[templateId] = `compile failed: ${compileResult.errors?.join('; ')}`
        console.error(`[Admin] Compile failed for ${templateId}:`, compileResult.errors)
      }
    } catch (err) {
      results[templateId] = `error: ${err instanceof Error ? err.message : 'unknown'}`
      console.error(`[Admin] Error for ${templateId}:`, err)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  return NextResponse.json({ results })
}

function runLatexmk(workDir: string): Promise<{ success: boolean; errors?: string[] }> {
  // Set TEXINPUTS so LaTeX can find template images
  const appDir = process.cwd()
  const texInputs = [
    workDir,
    path.join(appDir, 'newImages_whitebg') + '//',
    path.join(appDir, 'newImages') + '//',
    '',
  ].join(':')

  return new Promise((resolve) => {
    execFile(
      'latexmk',
      ['-xelatex', '-interaction=nonstopmode', '-halt-on-error', '-output-directory=' + workDir, 'main.tex'],
      {
        cwd: workDir,
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, TEXINPUTS: texInputs },
      },
      (error, stdout, stderr) => {
        if (error) {
          const log = stdout + '\n' + stderr
          const errors = log.split('\n').filter(l => l.startsWith('!')).slice(0, 5)
          console.error(`[Admin] LaTeX log (last 2000 chars):`, log.slice(-2000))
          resolve({ success: false, errors: errors.length > 0 ? errors : ['Compilation failed'] })
        } else {
          resolve({ success: true })
        }
      }
    )
  })
}

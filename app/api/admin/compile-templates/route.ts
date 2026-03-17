import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
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
 * One-time (or periodic) route to compile each template and cache
 * the resulting PDF in Supabase Storage under templates/{templateId}/main.pdf.
 * These cached PDFs are copied to new projects on creation so users
 * see a PDF immediately without waiting for compilation.
 */
export async function POST() {
  const supabase = createServiceClient()
  const results: Record<string, string> = {}

  for (const templateId of TEMPLATES) {
    const tmpDir = path.join(os.tmpdir(), `alefbook-template-${templateId}-${Date.now()}`)

    try {
      await fs.mkdir(tmpDir, { recursive: true })
      await fs.mkdir(path.join(tmpDir, 'images'), { recursive: true })

      const template = getTemplate(templateId, DEFAULT_PAGE_COUNT)
      await fs.writeFile(path.join(tmpDir, 'main.tex'), template.main, 'utf-8')

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
        } else {
          results[templateId] = 'ok'
        }
      } else {
        results[templateId] = `compile failed: ${compileResult.errors?.join('; ')}`
      }
    } catch (err) {
      results[templateId] = `error: ${err instanceof Error ? err.message : 'unknown'}`
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  return NextResponse.json({ results })
}

function runLatexmk(workDir: string): Promise<{ success: boolean; errors?: string[] }> {
  return new Promise((resolve) => {
    execFile(
      'latexmk',
      ['-xelatex', '-interaction=nonstopmode', '-halt-on-error', '-output-directory=' + workDir, 'main.tex'],
      { cwd: workDir, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const log = stdout + '\n' + stderr
          const errors = log.split('\n').filter(l => l.startsWith('!')).slice(0, 5)
          resolve({ success: false, errors: errors.length > 0 ? errors : ['Compilation failed'] })
        } else {
          resolve({ success: true })
        }
      }
    )
  })
}

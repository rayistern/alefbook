import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

/**
 * Render specific pages of a PDF to base64 PNG images using pdftoppm.
 * Returns an array of { page, base64 } objects.
 */
export async function renderPdfPages(
  pdfBuffer: Buffer,
  pages?: number[],
  dpi: number = 150
): Promise<{ page: number; base64: string }[]> {
  const tmpDir = path.join(os.tmpdir(), `alefbook-render-${Date.now()}`)
  await fs.mkdir(tmpDir, { recursive: true })

  const pdfPath = path.join(tmpDir, 'input.pdf')
  await fs.writeFile(pdfPath, pdfBuffer)

  try {
    // If specific pages requested, render each one
    // Otherwise render first 5 pages as a preview
    const pagesToRender = pages ?? [1, 2, 3, 4, 5]
    const results: { page: number; base64: string }[] = []

    for (const page of pagesToRender) {
      const outputPrefix = path.join(tmpDir, `page`)

      await new Promise<void>((resolve, reject) => {
        execFile(
          'pdftoppm',
          [
            '-png',
            '-r', String(dpi),
            '-f', String(page),
            '-l', String(page),
            '-singlefile',
            pdfPath,
            outputPrefix,
          ],
          { timeout: 15_000 },
          (error) => {
            if (error) reject(error)
            else resolve()
          }
        )
      })

      const pngPath = path.join(tmpDir, 'page.png')
      try {
        const pngBuffer = await fs.readFile(pngPath)
        results.push({
          page,
          base64: pngBuffer.toString('base64'),
        })
        await fs.unlink(pngPath)
      } catch {
        // Page doesn't exist (past end of PDF), skip
      }
    }

    return results
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Get total page count of a PDF using pdfinfo (from poppler-utils).
 */
export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  const tmpDir = path.join(os.tmpdir(), `alefbook-info-${Date.now()}`)
  await fs.mkdir(tmpDir, { recursive: true })
  const pdfPath = path.join(tmpDir, 'input.pdf')
  await fs.writeFile(pdfPath, pdfBuffer)

  try {
    return await new Promise<number>((resolve, reject) => {
      execFile('pdfinfo', [pdfPath], { timeout: 5000 }, (error, stdout) => {
        if (error) return reject(error)
        const match = stdout.match(/Pages:\s+(\d+)/)
        resolve(match ? parseInt(match[1], 10) : 0)
      })
    })
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

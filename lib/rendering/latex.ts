import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const execFileAsync = promisify(execFile)

const XELATEX_TIMEOUT = 60_000 // 60s for full book compilation
const FONTS_DIR = path.join(process.cwd(), 'templates/fonts')

/**
 * Compile a .tex source to PDF using XeLaTeX.
 * Runs two passes for correct page numbering and cross-references.
 */
export async function compileLatexToPdf(texSource: string): Promise<Buffer> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alefbook-latex-'))

  try {
    const texFile = path.join(tmpDir, 'book.tex')
    await fs.writeFile(texFile, texSource, 'utf-8')

    // Run XeLaTeX twice for page numbers / cross-references
    for (let pass = 1; pass <= 2; pass++) {
      try {
        await execFileAsync(
          'xelatex',
          [
            '--no-shell-escape',
            '-interaction=nonstopmode',
            `-output-directory=${tmpDir}`,
            texFile,
          ],
          {
            timeout: XELATEX_TIMEOUT,
            cwd: tmpDir,
            env: {
              ...process.env,
              // Make sure XeLaTeX can find our custom fonts
              OSFONTDIR: FONTS_DIR,
            },
          }
        )
      } catch {
        // XeLaTeX often exits non-zero on warnings — check if PDF was produced
        const pdfPath = path.join(tmpDir, 'book.pdf')
        const pdfExists = await fs.access(pdfPath).then(() => true).catch(() => false)
        if (!pdfExists) {
          // Read the log for diagnostics
          const logPath = path.join(tmpDir, 'book.log')
          const log = await fs.readFile(logPath, 'utf-8').catch(() => 'No log file')
          const lastLines = log.split('\n').slice(-30).join('\n')
          throw new Error(`XeLaTeX pass ${pass} failed. Last log lines:\n${lastLines}`)
        }
        // PDF exists despite non-zero exit — continue
      }
    }

    const pdfPath = path.join(tmpDir, 'book.pdf')
    return await fs.readFile(pdfPath)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Convert a PDF buffer to per-page PNG images using pdftoppm.
 * Returns a Map of 1-based page number to PNG buffer.
 */
export async function pdfToPagePngs(
  pdfBuffer: Buffer,
  dpi: number = 300
): Promise<Map<number, Buffer>> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alefbook-pdf2png-'))

  try {
    const pdfPath = path.join(tmpDir, 'book.pdf')
    await fs.writeFile(pdfPath, pdfBuffer)

    const outputPrefix = path.join(tmpDir, 'page')

    await execFileAsync(
      'pdftoppm',
      ['-png', '-r', String(dpi), pdfPath, outputPrefix],
      { timeout: XELATEX_TIMEOUT }
    )

    // pdftoppm outputs page-01.png, page-02.png, etc.
    const files = await fs.readdir(tmpDir)
    const pngFiles = files.filter((f: string) => f.startsWith('page-') && f.endsWith('.png')).sort()

    const pages = new Map<number, Buffer>()
    for (let i = 0; i < pngFiles.length; i++) {
      const pngBuffer = await fs.readFile(path.join(tmpDir, pngFiles[i]))
      pages.set(i + 1, pngBuffer)
    }

    return pages
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Compile LaTeX source to per-page PNG images.
 * This is the main entry point for the rendering pipeline.
 */
export async function renderLatexToPageImages(
  texSource: string,
  dpi: number = 300
): Promise<Map<number, Buffer>> {
  const pdfBuffer = await compileLatexToPdf(texSource)
  return pdfToPagePngs(pdfBuffer, dpi)
}

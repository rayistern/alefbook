/**
 * Extract page thumbnails from HaggadahPamphlet.pdf
 * Outputs small PNGs to public/thumbnails/page-{NNN}.png
 */
import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as mupdf from 'mupdf'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PDF_PATH = join(ROOT, 'HaggadahPamphlet.pdf')
const OUT_DIR = join(ROOT, 'public', 'thumbnails')

const THUMB_WIDTH = 120  // px

function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  const data = readFileSync(PDF_PATH)
  const doc = mupdf.Document.openDocument(data, 'application/pdf')
  const pageCount = doc.countPages()

  console.log(`PDF has ${pageCount} pages`)

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i)
    const bounds = page.getBounds()
    const pageWidth = bounds[2] - bounds[0]

    // Scale to thumbnail width
    const scale = THUMB_WIDTH / pageWidth
    const matrix = mupdf.Matrix.scale(scale, scale)

    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true)
    const pngData = pixmap.asPNG()

    const paddedNum = String(i + 1).padStart(3, '0')
    const outPath = join(OUT_DIR, `page-${paddedNum}.png`)
    writeFileSync(outPath, pngData)
    console.log(`  page ${i + 1} → page-${paddedNum}.png`)
  }

  console.log(`Done! ${pageCount} thumbnails written to ${OUT_DIR}`)
}

main()

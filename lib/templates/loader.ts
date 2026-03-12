import fs from 'fs'
import path from 'path'

export interface PageMeta {
  page_number: number
  label: string
  section: string
  is_fixed_liturgy: boolean
  content_summary: string
  has_image_slots: boolean
}

export interface TemplateMeta {
  template_id: string
  name: string
  description: string
  page_count: number
  page_width_px: number
  page_height_px: number
  bleed_px: number
  binding: string
  languages: string[]
  version: string
  pages: PageMeta[]
}

const PAGES_DIR = path.join(process.cwd(), 'templates/haggadah/pages')
const STUBS_DIR = path.join(process.cwd(), 'templates/stubs')
const METADATA_DIR = path.join(process.cwd(), 'templates/metadata')

export function getTemplateDir(): string {
  // Prefer real pages from Phase 1 if they exist
  if (fs.existsSync(PAGES_DIR) && fs.readdirSync(PAGES_DIR).length > 3) {
    return PAGES_DIR
  }
  return STUBS_DIR
}

export function loadTemplateMeta(): TemplateMeta {
  const templatePath = path.join(METADATA_DIR, 'template.json')
  const pagesPath = path.join(METADATA_DIR, 'pages.json')

  const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'))
  const pages = JSON.parse(fs.readFileSync(pagesPath, 'utf-8'))

  return { ...template, pages }
}

export function loadPageHTML(pageNumber: number, projectPageState?: string): string {
  // If project has a saved state for this page, use that
  if (projectPageState) return rewriteAssetPaths(projectPageState)

  // Otherwise load the template default
  const dir = getTemplateDir()
  const paddedNum = String(pageNumber).padStart(3, '0')
  const filePath = path.join(dir, `page-${paddedNum}.html`)

  if (fs.existsSync(filePath)) {
    return rewriteAssetPaths(fs.readFileSync(filePath, 'utf-8'))
  }

  // Check for variant with 'r' suffix (right-side pages in spreads)
  const filePathR = path.join(dir, `page-${paddedNum}r.html`)
  if (fs.existsSync(filePathR)) {
    return rewriteAssetPaths(fs.readFileSync(filePathR, 'utf-8'))
  }

  // Fallback: load cover stub for page 1, back stub for last page, interior for others
  // (only relevant while using stubs)
  return loadStubFallback(pageNumber)
}

/**
 * Rewrite relative asset paths from IDML-era conventions to paths
 * served by Next.js public/ directory, add font-display: swap to
 * prevent invisible text during font loading, and inject a loading
 * spinner that hides until all fonts are ready.
 */
function rewriteAssetPaths(html: string): string {
  let result = html
    // Fix asset paths
    .replace(/\.\.\/\.\.\/\.\.\/Document fonts\//g, '/fonts/')
    .replace(/\.\.\/\.\.\/\.\.\/images\//g, '/images/')
    // Add font-display: swap to all @font-face blocks so text is
    // visible immediately with a fallback font while custom fonts load
    .replace(/@font-face\s*\{([^}]*)\}/g, (match, body) => {
      if (body.includes('font-display')) return match
      return `@font-face {${body}  font-display: swap;\n}`
    })

  // Inject a loading overlay that disappears when fonts are ready.
  // Uses document.fonts.ready (supported in all modern browsers).
  const spinner = `
<style>
  .font-loading-overlay {
    position: fixed; inset: 0; z-index: 9999;
    background: #fff;
    display: flex; align-items: center; justify-content: center;
    transition: opacity 0.3s;
  }
  .font-loading-overlay.loaded { opacity: 0; pointer-events: none; }
  .font-spinner {
    width: 28px; height: 28px;
    border: 3px solid #e5e7eb; border-top-color: #6b7280;
    border-radius: 50%; animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
<div class="font-loading-overlay" id="fontOverlay">
  <div class="font-spinner"></div>
</div>
<script>
  document.fonts.ready.then(function() {
    var el = document.getElementById('fontOverlay');
    if (el) { el.classList.add('loaded'); setTimeout(function() { el.remove(); }, 400); }
  });
  // Safety timeout — remove overlay after 4s even if fonts fail
  setTimeout(function() {
    var el = document.getElementById('fontOverlay');
    if (el) { el.classList.add('loaded'); setTimeout(function() { el.remove(); }, 400); }
  }, 4000);
</script>`

  // Inject just before </body>
  if (result.includes('</body>')) {
    result = result.replace('</body>', `${spinner}\n</body>`)
  } else {
    result += spinner
  }

  return result
}

function loadStubFallback(pageNumber: number): string {
  const meta = loadTemplateMeta()

  let stubFile: string
  if (pageNumber === 1) {
    stubFile = 'cover-stub.html'
  } else if (pageNumber === meta.page_count) {
    stubFile = 'back-stub.html'
  } else {
    stubFile = 'interior-stub.html'
  }

  const stubPath = path.join(STUBS_DIR, stubFile)
  let html = fs.readFileSync(stubPath, 'utf-8')

  // Inject the correct page number
  html = html.replace(/data-page-number="\d+"/, `data-page-number="${pageNumber}"`)

  // Update page number display
  const pageInfo = meta.pages.find(p => p.page_number === pageNumber)
  if (pageInfo) {
    html = html.replace(
      /<div class="section-title">.*?<\/div>/,
      `<div class="section-title">${pageInfo.label}</div>`
    )
  }

  return html
}

export function loadAllPageStates(
  projectPageStates: Record<string, string>
): Record<number, string> {
  const meta = loadTemplateMeta()
  const result: Record<number, string> = {}

  for (let i = 1; i <= meta.page_count; i++) {
    result[i] = loadPageHTML(i, projectPageStates[String(i)])
  }

  return result
}

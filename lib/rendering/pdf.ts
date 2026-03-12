import puppeteer, { type Browser } from 'puppeteer-core'

let browser: Browser | null = null

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
      headless: true,
    })
  }
  return browser
}

function extractHeadStyles(html: string): string {
  // Extract ALL <style> blocks from the page (both head and body)
  const styles: string[] = []
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi
  let match
  while ((match = styleRegex.exec(html)) !== null) {
    styles.push(match[1])
  }
  return styles.length > 0 ? `<style>${styles.join('\n')}</style>` : ''
}

function extractBodyContent(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (bodyMatch) return bodyMatch[1]

  // If no body tag, get content after </head> or use the whole thing
  const headEnd = html.indexOf('</head>')
  if (headEnd !== -1) {
    const afterHead = html.substring(headEnd + 7)
    return afterHead.replace(/<\/?html[^>]*>/gi, '').replace(/<\/?body[^>]*>/gi, '')
  }

  return html
}

function buildPrintDocument(pageStates: Record<number, string>): string {
  const port = process.env.PORT || '8080'

  // Collect all unique styles from every page and the body content
  const allStyles: string[] = []
  const pages = Object.entries(pageStates)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, html]) => {
      const styles = extractHeadStyles(html)
      if (styles) allStyles.push(styles)
      // Strip inline <style> from body content to avoid duplication
      const body = extractBodyContent(html).replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      return `<div class="page-wrapper">${body}</div>`
    })
    .join('\n')

  return `<!DOCTYPE html>
<html>
<head>
<base href="http://localhost:${port}/">
${allStyles.join('\n')}
<style>
  @page { size: 152.4mm 152.4mm; margin: 0; }
  body { margin: 0; }
  .page-wrapper {
    width: 152.4mm;
    height: 152.4mm;
    page-break-after: always;
    overflow: hidden;
  }
</style>
</head>
<body>${pages}</body>
</html>`
}

export async function compileToPDF(
  pageStates: Record<number, string>
): Promise<Buffer> {
  const b = await getBrowser()
  const page = await b.newPage()

  try {
    const allPagesHtml = buildPrintDocument(pageStates)

    // Set a timeout to prevent infinite hangs
    await page.setContent(allPagesHtml, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    })

    // Wait for fonts with a timeout
    await Promise.race([
      page.evaluateHandle('document.fonts.ready'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Font loading timeout')), 10000)),
    ])

    const pdf = await page.pdf({
      width: '152.4mm',
      height: '152.4mm',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    })

    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

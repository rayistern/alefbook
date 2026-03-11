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

function extractBodyContent(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (bodyMatch) return bodyMatch[1]

  // If no body tag, extract style and content
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i)
  const style = styleMatch ? `<style>${styleMatch[1]}</style>` : ''

  // Try to get content after </head> or just use the whole thing
  const headEnd = html.indexOf('</head>')
  if (headEnd !== -1) {
    const afterHead = html.substring(headEnd + 7)
    const withoutHtmlTags = afterHead.replace(/<\/?html[^>]*>/gi, '').replace(/<\/?body[^>]*>/gi, '')
    return style + withoutHtmlTags
  }

  return style + html
}

function buildPrintDocument(pageStates: Record<number, string>): string {
  const pages = Object.entries(pageStates)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, html]) => `<div class="page-wrapper">${extractBodyContent(html)}</div>`)
    .join('\n')

  return `<!DOCTYPE html>
<html>
<head>
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
    await page.setContent(allPagesHtml, { waitUntil: 'networkidle0' })
    await page.evaluateHandle('document.fonts.ready')

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

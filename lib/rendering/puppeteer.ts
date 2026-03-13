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
        '--force-color-profile=srgb',
      ],
      headless: true,
    })
  }
  return browser
}

export async function renderPageToImage(html: string): Promise<Buffer> {
  const b = await getBrowser()
  const page = await b.newPage()

  try {
    // Inject <base> so absolute paths (/fonts/, /images/) resolve to the local server
    const port = process.env.PORT || '8080'
    const baseTag = `<base href="http://localhost:${port}/">`

    // Strip the font-loading overlay injected by rewriteAssetPaths —
    // it has position:fixed + white bg that covers the entire screenshot.
    // Puppeteer waits for fonts separately via document.fonts.ready below.
    let cleanHtml = html
      .replace(/<div class="font-loading-overlay"[\s\S]*?<\/div>\s*<\/div>/gi, '')
      .replace(/<script>[\s\S]*?fontOverlay[\s\S]*?<\/script>/gi, '')
      .replace(/<style>[^<]*\.font-loading-overlay[\s\S]*?<\/style>/gi, '')

    // Inject base tag and ensure white background (Chromium headless can default to dark canvas)
    const bgFix = `<style>html,body{background:#fff;color-scheme:light;}</style>`
    const htmlWithBase = cleanHtml.includes('<head>')
      ? cleanHtml.replace('<head>', `<head>${baseTag}${bgFix}`)
      : `<html><head>${baseTag}${bgFix}</head><body>${cleanHtml}</body></html>`

    // Log failed resource loads for debugging
    page.on('requestfailed', (req) => {
      console.warn('[Render] Resource failed:', req.url(), req.failure()?.errorText)
    })

    // Force light color scheme so backgrounds render correctly
    await page.emulateMediaFeatures([
      { name: 'prefers-color-scheme', value: 'light' },
    ])

    // 576px = 540px page + 18px bleed each side
    // deviceScaleFactor 2 = retina/2x PNG
    await page.setViewport({ width: 576, height: 576, deviceScaleFactor: 2 })
    await page.setContent(htmlWithBase, { waitUntil: 'networkidle0', timeout: 15000 })

    // Wait for fonts with timeout to prevent hangs
    await Promise.race([
      page.evaluateHandle('document.fonts.ready'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Font loading timeout')), 10000)),
    ])

    const screenshot = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: 576, height: 576 },
    })

    return Buffer.from(screenshot)
  } finally {
    await page.close()
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close()
    browser = null
  }
}

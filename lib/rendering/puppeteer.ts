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

export async function renderPageToImage(html: string): Promise<Buffer> {
  const b = await getBrowser()
  const page = await b.newPage()

  try {
    // Inject <base> so absolute paths (/fonts/, /images/) resolve to the local server
    const port = process.env.PORT || '8080'
    const baseTag = `<base href="http://localhost:${port}/">`
    const htmlWithBase = html.includes('<head>')
      ? html.replace('<head>', `<head>${baseTag}`)
      : `<html><head>${baseTag}</head><body>${html}</body></html>`

    // 576px = 540px page + 18px bleed each side
    // deviceScaleFactor 2 = retina/2x PNG
    await page.setViewport({ width: 576, height: 576, deviceScaleFactor: 2 })
    await page.setContent(htmlWithBase, { waitUntil: 'networkidle0' })
    await page.evaluateHandle('document.fonts.ready')

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

const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const pagesDir = path.resolve(__dirname, 'templates/haggadah/pages');
  const outDir = path.resolve(__dirname, 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });

  const files = fs.readdirSync(pagesDir)
    .filter(f => f.endsWith('.html'))
    .sort();

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 576, height: 576 },
    deviceScaleFactor: 2,
  });

  for (const file of files) {
    const page = await context.newPage();
    const filePath = path.join(pagesDir, file);
    await page.goto('file://' + filePath, { waitUntil: 'networkidle' });
    // Wait for fonts to load
    await page.waitForTimeout(500);
    const outFile = path.join(outDir, file.replace('.html', '.png'));
    await page.screenshot({ path: outFile, clip: { x: 0, y: 0, width: 576, height: 576 } });
    console.log('OK', file);
    await page.close();
  }

  await browser.close();
  console.log('Done — all screenshots saved to screenshots/');
})();

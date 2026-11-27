// Prints index.html (Cate's maker introduction for galleries) to an A4 PDF beside it.
// Run from anywhere: node docs/maker-introduction/build.cjs (needs Playwright with Chromium).
const { chromium } = require('playwright');
const path = require('node:path');

const dir = __dirname;
const out = path.join(dir, 'Cate Pates - Maker introduction.pdf');

(async () => {
  const browser = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const page = await browser.newPage();
  await page.goto(`file://${path.join(dir, 'index.html')}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await browser.close();
  console.log(`Wrote ${out}`);
})();

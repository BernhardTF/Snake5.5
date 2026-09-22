// Usage: node scripts/shot.mjs <url> <out.png> [width] [height] [waitMs] [actions-json]
// Headless Chromium screenshot helper for visual QA.
import { chromium } from 'playwright';
const [url, out, w = '1280', h = '800', wait = '2500', actions = '[]'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
for (const a of JSON.parse(actions)) {
  if (a.wait) await page.waitForTimeout(a.wait);
  if (a.click) await page.click(a.click);
  if (a.key) await page.keyboard.press(a.key);
  if (a.eval) await page.evaluate(a.eval);
}
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
console.log(logs.slice(-40).join('\n'));
await browser.close();

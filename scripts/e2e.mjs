// End-to-end smoke test of the real app in headless Chromium.
// Usage: node scripts/e2e.mjs [baseUrl] [outDir] [width] [height] [query]
import { chromium } from 'playwright';
const [base = 'http://localhost:5310/', out = '.qa', w = '1280', h = '800', query = ''] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const tag = `${w}x${h}`;
const shot = (n) => page.screenshot({ path: `${out}/e2e-${tag}-${n}.png` });
await page.goto(base + query, { waitUntil: 'load' });
await page.waitForTimeout(4000);
await page.keyboard.press('Space');
await page.waitForTimeout(1500);
await shot('1-title');
await page.click('.btn-play');
await page.waitForTimeout(1500);
await shot('2-setup');
await page.click('button:has-text("Start")');
await page.waitForTimeout(1200);
await shot('3-countdown');
await page.waitForTimeout(3500);
await page.keyboard.press('ArrowUp');
await page.waitForTimeout(700);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(1500);
await shot('4-play');
const state1 = await page.evaluate(() => { const a = window.__app; return { state: a.state, score: a.sim?.score, alive: a.sim?.alive, len: a.sim?.lengthCells }; });
console.log('during play', JSON.stringify(state1));
// wait for the wall
for (let i = 0; i < 40; i++) {
  const s = await page.evaluate(() => window.__app.state);
  if (s === 'over') break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(3000);
await shot('5-over');
const state2 = await page.evaluate(() => ({ state: window.__app.state, profile: JSON.parse(localStorage.getItem('serpent-sands:profile') || '{}').stats }));
console.log('after', JSON.stringify(state2));
console.log(logs.slice(0, 30).join('\n'));
await browser.close();

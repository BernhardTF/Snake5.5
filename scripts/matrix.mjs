// Starts each mode/biome/movement combo in the real app and reports errors + screenshots.
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:5310/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errs.push(m.text().slice(0, 300)); });
await page.goto(base + '?unlock', { waitUntil: 'load' });
await page.waitForTimeout(3000);
const combos = [
  ['arcade','grid','erg','obsidian'], ['zen','glide','lagoon','crystal'], ['timeattack','grid','svartsandur','nebula'], ['classic','glide','salar','gaboon'], ['daily','grid','karesansui','eyelash'],
  ['arcade','glide','pinksands','centipede'], ['zen','grid','vaadhoo','eel'], ['classic','grid','dallol','dragon'], ['timeattack','glide','luna','mecha'],
  ['arcade','grid','mars','train'], ['classic','glide','titan','comet'], ['zen','grid','kepler','sunbeam'],
];
for (const [mode, movement, biome, skin] of combos) {
  await page.evaluate((r) => window.__app.startGame(r), { mode, movement, biome, skin });
  await page.waitForTimeout(3600);
  // steer around a bit
  for (const k of ['ArrowUp','ArrowLeft','ArrowDown','ArrowRight']) { await page.keyboard.down(k); await page.waitForTimeout(350); await page.keyboard.up(k); }
  await page.waitForTimeout(800);
  const s = await page.evaluate(() => { const a = window.__app; return { state: a.state, alive: a.sim?.alive, score: a.sim?.score, biome: a.sim?.cfg.biome, t: a.sim?.timeLeft }; });
  await page.screenshot({ path: `.qa/matrix-${mode}-${movement}-${biome}-${skin}.png` });
  console.log(mode, movement, biome, skin, JSON.stringify(s), errs.length ? 'ERRORS: ' + errs.splice(0).join(' | ') : 'ok');
  await page.evaluate(() => window.__app.quitToMenu());
  await page.waitForTimeout(500);
}
await browser.close();

// Usage: node scripts/audio-check.mjs [baseUrl=http://localhost:5303] [--no-wav] [--wav-all] [--only=music,scene,sfx,slither,legend,stress,wav,perf]
// Runs the offline audio self-test (12 biomes, 6 Legends) + a realtime main-thread cost probe in
// headless Chromium, prints results, writes .qa/audio-<biome>.wav, .qa/audio-legend-<id>.wav and
// .qa/audio-metrics.json.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:5303';
const wav = !process.argv.includes('--no-wav');
const wavAll = process.argv.includes('--wav-all');
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
const q = `selftest=1${wav ? '&wav=1' : ''}${wavAll ? '&wavall=1' : ''}${only ? '&only=' + only : ''}`;
await page.goto(`${base}/?dev=audio&${q}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__audioSelfTestDone === true, null, { timeout: 1800000, polling: 500 });
const res = await page.evaluate(() => ({ pass: window.__audioSelfTest.pass, fail: window.__audioSelfTest.fail, wavs: window.__audioSelfTest.wavs, metrics: window.__audioSelfTest.metrics }));
mkdirSync('.qa', { recursive: true });
for (const [b, b64] of Object.entries(res.wavs ?? {})) {
  const f = `.qa/audio-${b}.wav`;
  writeFileSync(f, Buffer.from(b64, 'base64'));
  console.log('wrote', f);
}
writeFileSync('.qa/audio-metrics.json', JSON.stringify(res.metrics ?? {}, null, 1));
console.log('wrote .qa/audio-metrics.json');
console.log(`RESULT pass=${res.pass} fail=${res.fail}`);
await browser.close();
process.exit(res.fail ? 1 : 0);

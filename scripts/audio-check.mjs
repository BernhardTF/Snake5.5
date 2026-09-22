// Usage: node scripts/audio-check.mjs [baseUrl=http://localhost:5303] [--no-wav]
// Runs the offline audio self-test in headless Chromium, prints results, writes .qa/audio-<biome>.wav
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:5303';
const wav = !process.argv.includes('--no-wav');
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(`${base}/?dev=audio&selftest=1${wav ? '&wav=1' : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__audioSelfTestDone === true, null, { timeout: 900000, polling: 500 });
const res = await page.evaluate(() => ({ pass: window.__audioSelfTest.pass, fail: window.__audioSelfTest.fail, wavs: window.__audioSelfTest.wavs }));
mkdirSync('.qa', { recursive: true });
for (const [b, b64] of Object.entries(res.wavs ?? {})) {
  const f = `.qa/audio-${b}.wav`;
  writeFileSync(f, Buffer.from(b64, 'base64'));
  console.log('wrote', f);
}
console.log(`RESULT pass=${res.pass} fail=${res.fail}`);
await browser.close();
process.exit(res.fail ? 1 : 0);

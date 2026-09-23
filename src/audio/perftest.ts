// Main-thread cost of switching biome / character on a realtime AudioContext (dev self-test).
// Measures the synchronous call, the scheduler ticks that follow (first bars may render KS
// notes synchronously) and the idle pre-render jobs (sliced like the live engine does).
import type { BiomeId, SkinId } from '../types';
import { AudioCore } from './core';
import { LEGEND_IDS } from './legends';
import { BIOME_IDS } from './selftest';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r2 = (x: number) => Math.round(x * 100) / 100;

export async function runPerfTest(log: (s: string) => void) {
  const AC = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!AC) { log('[perf] no AudioContext'); return { skipped: true }; }
  const ctx = new AC({ latencyHint: 'interactive' });
  try { await ctx.resume(); } catch { /* */ }
  if (ctx.state !== 'running') { log(`[perf] context ${ctx.state}, skipped`); void ctx.close(); return { skipped: true }; }
  const core = new AudioCore(ctx, ctx.destination, { seed: 7 });
  core.setVolumes(1, 1, 1, true);
  core.setScene('game');
  core.setIntensity(0.9);
  const out: Record<string, { call: number; maxTick: number; maxJobSlice: number; jobTotal: number; drainMs: number }> = {};

  const drive = async (minMs: number, maxMs: number) => {
    let maxTick = 0, maxJob = 0, jobTotal = 0;
    const t0 = performance.now();
    let drained = -1;
    for (;;) {
      const el = performance.now() - t0;
      if (el > maxMs || (el > minMs && !core.hasJobs)) break;
      let a = performance.now();
      core.tick();
      maxTick = Math.max(maxTick, performance.now() - a);
      if (core.hasJobs) {
        a = performance.now();
        core.runJobs(6);
        const d = performance.now() - a;
        maxJob = Math.max(maxJob, d);
        jobTotal += d;
        if (!core.hasJobs && drained < 0) drained = performance.now() - t0;
      }
      await sleep(25);
    }
    return { maxTick: r2(maxTick), maxJobSlice: r2(maxJob), jobTotal: r2(jobTotal), drainMs: Math.round(drained < 0 ? 0 : drained) };
  };

  const switchTo = async (name: string, fn: () => void, minMs: number) => {
    const a = performance.now();
    fn();
    const call = r2(performance.now() - a);
    const d = await drive(minMs, 8000);
    out[name] = { call, ...d };
    log(`[perf] ${name.padEnd(18)} call=${call}ms maxTick=${d.maxTick}ms maxJobSlice=${d.maxJobSlice}ms jobTotal=${d.jobTotal}ms drained@${d.drainMs}ms`);
  };

  for (const b of BIOME_IDS as BiomeId[]) await switchTo('biome:' + b, () => core.setBiome(b), 1600);
  core.setSlither(7, 1);
  for (const id of [...LEGEND_IDS, 'obsidian', 'centipede', 'eel'] as SkinId[]) await switchTo('char:' + id, () => { core.setCharacter(id); core.setSlither(7, 1); }, 500);
  const worst = Object.values(out).reduce((m, x) => Math.max(m, x.call, x.maxTick, x.maxJobSlice), 0);
  log(`[perf] worst single main-thread slice: ${r2(worst)}ms`);
  core.dispose();
  void ctx.close();
  return { ...out, worst: r2(worst) };
}

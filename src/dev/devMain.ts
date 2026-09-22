// Dev harness:
//   ?dev=render&biome=erg&skin=coral&w=28&h=18&q=high&ff=600   – renderer with scripted snake
//   ?dev=audio                                                – audio test bench (audio agent)
//   ?dev=ui&screen=title                                      – UI screens with mock host (ui agent)
import { FakeWorld } from './fakeFrame';
import type { BiomeId, SkinId } from '../types';

export async function runDev(kind: string, params: URLSearchParams) {
  if (kind === 'audio') return (await import('./audioDev')).runAudioDev(params);
  if (kind === 'ui') return (await import('./uiDev')).runUiDev(params);
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const { GameRenderer } = await import('../render/GameRenderer');
  const r = new GameRenderer(canvas);
  const world = new FakeWorld(+(params.get('w') ?? 28), +(params.get('h') ?? 18));
  world.skin = (params.get('skin') as SkinId) ?? 'obsidian';
  r.setOptions({
    quality: (params.get('q') as any) ?? 'high', renderScale: 1, bloom: true, dof: true,
    particles: true, reducedMotion: false, highContrastFood: false,
  });
  r.setBiome((params.get('biome') as BiomeId) ?? 'karesansui');
  r.setBoard(world.boardW, world.boardH);
  const fit = () => r.resize(innerWidth, innerHeight, Math.min(2, devicePixelRatio));
  addEventListener('resize', fit);
  fit();
  // Fast-forward so screenshots show a long trail
  const ff = +(params.get('ff') ?? 0);
  for (let i = 0; i < ff; i++) r.render(world.frame(1 / 30));
  const loop = () => { r.render(world.frame()); requestAnimationFrame(loop); };
  loop();
  (window as any).__dev = { r, world };
}

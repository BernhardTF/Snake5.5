import { runtime } from '../../core/runtime';
import { h } from '../dom';
import { btn } from '../widgets';
import type { Screen, ScreenCtx } from '../ctx';
import { store } from '../../core/storage';
import { BIOME_BY_ID } from '../../biomes/biomes';
import { MODE_BY_ID } from './setup';

export function buildPause(ctx: ScreenCtx): Screen {
  const s = store.settings;
  const resume = btn({ cls: 'btn-primary', label: 'Resume', icon: 'play', onClick: () => ctx.host.resume() });
  const el = h(
    'section',
    { class: 'screen screen-pause' },
    h('div', { class: 'scrim scrim-dim' }),
    h(
      'div',
      { class: 'panel pause-panel stagger', role: 'dialog', 'aria-label': 'Paused' },
      h('div', { class: 'kicker', style: { '--i': '0' } }, `${MODE_BY_ID[s.lastMode]?.name ?? ''} · ${BIOME_BY_ID[runtime.runBiome ?? s.lastBiome]?.name ?? ''}`),
      h('h1', { class: 'screen-title pause-title', style: { '--i': '0' } }, 'Paused'),
      h(
        'div',
        { class: 'pause-actions', style: { '--i': '1' } },
        resume,
        btn({ cls: 'btn-ghost', label: 'Restart', icon: 'retry', onClick: () => ctx.host.restart() }),
        btn({ cls: 'btn-ghost', label: 'Settings', icon: 'settings', onClick: () => ctx.go('settings') }),
        btn({ cls: 'btn-ghost', label: 'Quit to menu', icon: 'menu', sfx: 'back', onClick: () => ctx.host.quitToMenu() }),
      ),
      h('div', { class: 'pause-hint muted small', style: { '--i': '2' } }, ctx.touch ? 'Tap Resume to continue' : 'Esc to resume'),
    ),
  );
  return {
    el,
    focus: resume,
    onBack: () => {
      ctx.sound('click');
      ctx.host.resume();
    },
  };
}

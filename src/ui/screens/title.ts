import { h, icon, fmtInt } from '../dom';
import { ICONS } from '../icons';
import { btn, progress } from '../widgets';
import type { Screen, ScreenCtx } from '../ctx';
import { store, todayKey } from '../../core/storage';
import { levelProgress, MAX_LEVEL } from '../../game/progression';

export const VERSION = 'v1.0';

export function logo(cls = '') {
  return h(
    'div',
    { class: `logo ${cls}`, role: 'heading', 'aria-level': '1', 'aria-label': 'Serpent Sands' },
    h('div', { class: 'logo-word' }, h('span', { class: 'lw lw1' }, 'Serpent'), h('span', { class: 'lw lw2' }, 'Sands')),
    h(
      'div',
      { class: 'logo-sub' },
      h('span', { class: 'logo-rule' }),
      h('span', { class: 'logo-subtext' }, 'Snake, re-imagined'),
      h('span', { class: 'logo-rule' }),
    ),
  );
}

export function buildTitle(ctx: ScreenCtx): Screen {
  const p = levelProgress(store.profile.xp);
  const today = store.profile.daily[todayKey()];

  const profileChip = btn(
    {
      cls: 'chip profile-chip',
      title: `Level ${p.level}. Open records`,
      onClick: () => ctx.go('records'),
    },
    h('span', { class: 'lvl-medal' }, String(p.level)),
    h(
      'span',
      { class: 'chip-body' },
      h('span', { class: 'chip-top' }, 'Level ', h('b', null, String(p.level))),
      progress(p.level >= MAX_LEVEL ? 1 : p.into / p.need, 'bar-xs'),
      h('span', { class: 'chip-sub' }, p.level >= MAX_LEVEL ? 'Max level' : `${fmtInt(p.into)} / ${fmtInt(p.need)} XP`),
    ),
  );

  const dailyChip = btn(
    {
      cls: 'chip daily-chip',
      title: 'Play the Daily Seed',
      onClick: () => {
        store.saveSettings({ lastMode: 'daily' });
        ctx.go('setup');
      },
    },
    h('span', { class: 'chip-ic' }, icon(ICONS.daily)),
    h(
      'span',
      { class: 'chip-body' },
      h('span', { class: 'chip-top' }, 'Daily Seed'),
      h('span', { class: 'chip-sub' }, today ? `Today's best ${fmtInt(today)}` : 'New board today'),
    ),
  );

  const play = btn({ cls: 'btn-primary btn-play', label: 'Play', icon: 'play', onClick: () => ctx.go('setup') });
  const sec = (label: string, ic: keyof typeof ICONS, to: Parameters<ScreenCtx['go']>[0]) =>
    btn({ cls: 'btn-tile', label, icon: ic, onClick: () => ctx.go(to) });

  const menu = h(
    'nav',
    { class: 'title-menu stagger', 'aria-label': 'Main menu' },
    h('div', { class: 'title-play', style: { '--i': '0' } }, play),
    h(
      'div',
      { class: 'title-tiles', style: { '--i': '1' } },
      sec('Snakes', 'snake', 'skins'),
      sec('Achievements', 'trophy', 'achievements'),
      sec('Records', 'records', 'records'),
      sec('Settings', 'settings', 'settings'),
      sec('Credits', 'credits', 'credits'),
    ),
  );

  const hint = h('div', { class: 'title-hint', 'aria-live': 'polite' }, h('span', { class: 'hint-key' }, ctx.touch ? 'Tap to begin' : 'Press any key'), ctx.touch ? null : h('span', { class: 'hint-or' }, 'or tap to begin'));

  const top = h('div', { class: 'title-top' }, profileChip, dailyChip);

  const el = h(
    'section',
    { class: 'screen screen-home' },
    h('div', { class: 'scrim scrim-title' }),
    top,
    h('div', { class: 'title-logo' }, logo()),
    h('div', { class: 'title-bottom' }, hint, menu),
    h('div', { class: 'version' }, `Serpent Sands ${VERSION}`),
  );

  const waiting = ctx.awaitingGesture();
  const scr: Screen = { el, focus: waiting ? null : play, onBack: () => false };
  if (waiting) {
    el.classList.add('awaiting');
    ctx.onGesture(() => {
      el.classList.remove('awaiting');
      el.classList.add('revealed');
      scr.focus = play;
      requestAnimationFrame(() => play.focus({ preventScroll: true }));
    });
  }
  return scr;
}

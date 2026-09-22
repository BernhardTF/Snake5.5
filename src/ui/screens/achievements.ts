import { h, fmtDate } from '../dom';
import { progress, screenHead } from '../widgets';
import type { Screen, ScreenCtx } from '../ctx';
import { store } from '../../core/storage';
import { ACHIEVEMENTS } from '../../game/achievements';

export function buildAchievements(ctx: ScreenCtx): Screen {
  const prof = store.profile;
  const earned = ACHIEVEMENTS.filter((a) => prof.achievements[a.id]).length;
  const list = h('div', { class: 'ach-grid stagger' });
  const items: HTMLElement[] = [];

  ACHIEVEMENTS.forEach((a, i) => {
    const at = prof.achievements[a.id];
    const prog = !at && a.progress ? a.progress(prof) : null;
    const item = h(
      'div',
      {
        class: `ach${at ? ' earned' : ''}`,
        tabindex: '0',
        role: 'listitem',
        'aria-label': `${a.name}. ${a.description} ${at ? 'Earned.' : 'Not earned yet.'}`,
        style: { '--i': String(Math.min(i, 16)) },
      },
      h('span', { class: 'ach-medal' }, h('span', { class: 'ach-icon' }, a.icon)),
      h(
        'span',
        { class: 'ach-text' },
        h('span', { class: 'ach-name' }, a.name),
        h('span', { class: 'ach-desc' }, a.description),
        at
          ? h('span', { class: 'ach-date' }, `Earned ${fmtDate(at)}`)
          : prog !== null
            ? h('span', { class: 'ach-prog' }, progress(prog, 'bar-xs'), h('span', { class: 'ach-pct' }, `${Math.floor(prog * 100)}%`))
            : h('span', { class: 'ach-date muted' }, 'Not yet earned'),
      ),
    );
    items.push(item);
    list.appendChild(item);
  });

  const el = h(
    'section',
    { class: 'screen screen-achievements' },
    h('div', { class: 'scrim scrim-full' }),
    screenHead(
      ctx,
      'Achievements',
      'Milestones',
      h('span', { class: 'counter' }, h('b', null, String(earned)), ` / ${ACHIEVEMENTS.length}`),
    ),
    h(
      'div',
      { class: 'screen-scroll' },
      h('div', { class: 'panel panel-wide' }, h('div', { class: 'ach-summary' }, progress(earned / ACHIEVEMENTS.length, 'bar-gold')), list),
    ),
  );
  return { el, focus: items[0] };
}

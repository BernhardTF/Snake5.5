import { h, icon } from '../dom';
import { ICONS } from '../icons';
import { screenHead, skinSwatch, tabs } from '../widgets';
import type { Screen, ScreenCtx } from '../ctx';
import { store } from '../../core/storage';
import { SKINS, SNAKE_SKINS, LEGENDS, SKIN_BY_ID, type SkinInfo } from '../../skins/skins';
import { isSkinUnlocked } from '../../game/progression';

type Tab = 'snakes' | 'legends';

/** The Collection screen (ScreenId 'skins'): Snakes and Legends tabs. */
export function buildSkins(ctx: ScreenCtx): Screen {
  const prof = store.profile;
  const unlockedCount = SKINS.filter((s) => isSkinUnlocked(prof, s.id)).length;
  const cards: HTMLButtonElement[] = [];
  const count = (list: SkinInfo[]) => `${list.filter((s) => isSkinUnlocked(prof, s.id)).length}/${list.length}`;

  function card(s: SkinInfo, i: number) {
    const unlocked = isSkinUnlocked(prof, s.id);
    const legend = s.kind === 'legend';
    const c = h(
      'button',
      {
        type: 'button',
        class: `card skin-card${legend ? ' legend-card' : ''}${unlocked ? '' : ' locked'}`,
        'data-skin': s.id,
        'data-sfx': unlocked ? 'toggle' : 'back',
        role: 'radio',
        'aria-label': `${legend ? 'Legend. ' : ''}${s.name}, ${s.species}. ${unlocked ? s.description : `Locked. ${s.unlockText}`}`,
        style: { '--i': String(Math.min(i, 12)) },
      },
      h(
        'span',
        { class: 'skin-stage' },
        legend ? h('span', { class: 'legend-shine', 'aria-hidden': 'true' }) : null,
        legend ? h('span', { class: 'legend-badge' }, icon(ICONS.crown), 'Legend') : null,
        skinSwatch(s),
        unlocked ? null : h('span', { class: 'skin-lock' }, icon(ICONS.lock)),
      ),
      h(
        'span',
        { class: 'skin-meta' },
        h('span', { class: 'skin-name' }, s.name),
        h('span', { class: 'skin-species' }, s.species),
        h('span', { class: 'skin-desc' }, s.description),
        h(
          'span',
          { class: `skin-status${unlocked ? '' : ' is-locked'}` },
          unlocked ? h('span', { class: 'status-equipped' }, icon(ICONS.check), 'Equipped') : null,
          unlocked ? h('span', { class: 'status-free' }, 'Unlocked') : s.unlockText,
        ),
      ),
    );
    c.addEventListener('click', () => {
      if (!unlocked) {
        c.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 260 });
        return;
      }
      store.saveSettings({ skin: s.id });
      ctx.host.previewSkin(s.id);
      paint();
    });
    cards.push(c);
    return c;
  }

  const snakeGrid = h('div', { class: 'skin-grid stagger', role: 'radiogroup', 'aria-label': 'Snakes', id: 'coll-snakes' }, SNAKE_SKINS.map(card));
  const legendGrid = h(
    'div',
    { class: 'legend-wrap', id: 'coll-legends' },
    h('p', { class: 'legend-intro' }, 'Legends are not snakes. Each one moves, sounds and grows in its own way.'),
    h('div', { class: 'skin-grid legend-grid stagger', role: 'radiogroup', 'aria-label': 'Legends' }, LEGENDS.map(card)),
  );

  let tab: Tab = SKIN_BY_ID[store.settings.skin]?.kind === 'legend' ? 'legends' : 'snakes';
  const show = (t: Tab) => {
    tab = t;
    snakeGrid.hidden = t !== 'snakes';
    legendGrid.hidden = t !== 'legends';
    panel.classList.toggle('tab-legends', t === 'legends');
  };
  const tabBar = tabs<Tab>(
    [
      { value: 'snakes', label: 'Snakes', icon: 'snake', count: count(SNAKE_SKINS) },
      { value: 'legends', label: 'Legends', icon: 'crown', count: count(LEGENDS), cls: 'tab-legend' },
    ],
    tab,
    (t) => show(t),
    'Collection',
    'coll-tabs',
  );
  tabBar.buttons[0].setAttribute('aria-controls', 'coll-snakes');
  tabBar.buttons[1].setAttribute('aria-controls', 'coll-legends');

  const panel = h('div', { class: 'panel panel-wide coll-panel' }, h('div', { class: 'coll-bar' }, tabBar.el), snakeGrid, legendGrid);
  show(tab);

  function paint() {
    for (const c of cards) {
      const on = c.dataset.skin === store.settings.skin;
      c.classList.toggle('on', on);
      c.setAttribute('aria-checked', String(on));
    }
  }
  paint();

  const el = h(
    'section',
    { class: 'screen screen-skins' },
    h('div', { class: 'scrim scrim-full' }),
    screenHead(ctx, 'Collection', 'Snakes & Legends', h('span', { class: 'counter' }, h('b', null, String(unlockedCount)), ` / ${SKINS.length}`)),
    h('div', { class: 'screen-scroll' }, panel),
  );
  const focus = cards.find((c) => c.dataset.skin === store.settings.skin && !c.closest('[hidden]')) ?? tabBar.buttons[tab === 'snakes' ? 0 : 1];
  return { el, focus };
}

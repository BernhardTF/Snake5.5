import { h, icon } from '../dom';
import { ICONS } from '../icons';
import { screenHead, skinSwatch } from '../widgets';
import type { Screen, ScreenCtx } from '../ctx';
import { store } from '../../core/storage';
import { SKINS } from '../../skins/skins';
import { isSkinUnlocked } from '../../game/progression';

export function buildSkins(ctx: ScreenCtx): Screen {
  const prof = store.profile;
  const unlockedCount = SKINS.filter((s) => isSkinUnlocked(prof, s.id)).length;
  const cards: HTMLButtonElement[] = [];
  const grid = h('div', { class: 'skin-grid stagger' });

  SKINS.forEach((s, i) => {
    const unlocked = isSkinUnlocked(prof, s.id);
    const card = h(
      'button',
      {
        type: 'button',
        class: `card skin-card${unlocked ? '' : ' locked'}`,
        'data-skin': s.id,
        'data-sfx': unlocked ? 'toggle' : 'back',
        role: 'radio',
        'aria-label': unlocked ? `${s.name}, ${s.species}` : `${s.name}, locked. ${s.unlockText}`,
        style: { '--i': String(i) },
      },
      h('span', { class: 'skin-stage' }, skinSwatch(s), unlocked ? null : h('span', { class: 'skin-lock' }, icon(ICONS.lock))),
      h('span', { class: 'skin-meta' },
        h('span', { class: 'skin-name' }, s.name),
        h('span', { class: 'skin-species' }, s.species),
        h('span', { class: 'skin-desc' }, s.description),
        h('span', { class: `skin-status${unlocked ? '' : ' is-locked'}` }, unlocked ? h('span', { class: 'status-equipped' }, icon(ICONS.check), 'Equipped') : null, unlocked ? h('span', { class: 'status-free' }, 'Unlocked') : s.unlockText),
      ),
    );
    card.addEventListener('click', () => {
      if (!unlocked) {
        card.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 260 });
        return;
      }
      store.saveSettings({ skin: s.id });
      ctx.host.previewSkin(s.id);
      paint();
    });
    cards.push(card);
    grid.appendChild(card);
  });

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
    screenHead(ctx, 'Snakes', 'Collection', h('span', { class: 'counter' }, h('b', null, String(unlockedCount)), ` / ${SKINS.length}`)),
    h('div', { class: 'screen-scroll' }, h('div', { class: 'panel panel-wide' }, grid)),
  );
  const focus = cards.find((c) => c.dataset.skin === store.settings.skin) ?? cards[0];
  return { el, focus };
}

import { h, icon, fmtInt, fmtDayShort } from '../dom';
import { ICONS, type IconName } from '../icons';
import { btn, screenHead, sectionTitle, segmented, skinDot, tabs } from '../widgets';
import type { Screen, ScreenCtx } from '../ctx';
import { store, bestKey, todayKey } from '../../core/storage';
import { BIOMES, BIOME_BY_ID, type Realm } from '../../biomes/biomes';
import { SKIN_BY_ID } from '../../skins/skins';
import { isBiomeUnlocked, isSkinUnlocked, levelFromXp } from '../../game/progression';
import type { BiomeId, GameModeId, MovementMode } from '../../types';

export interface ModeInfo {
  id: GameModeId;
  name: string;
  desc: string;
  icon: IconName;
}

export const MODES: ModeInfo[] = [
  { id: 'classic', name: 'Classic', desc: 'Eat, grow, survive. The pure form.', icon: 'classic' },
  { id: 'arcade', name: 'Arcade', desc: 'Power-ups, golden food, big combos.', icon: 'arcade' },
  { id: 'zen', name: 'Zen', desc: 'No death. Walls wrap. Just rake.', icon: 'zen' },
  { id: 'timeattack', name: 'Time Attack', desc: '120 seconds. Golden food adds time.', icon: 'timeattack' },
  { id: 'daily', name: 'Daily Seed', desc: 'One board for everyone, today.', icon: 'daily' },
];
export const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<GameModeId, ModeInfo>;

export function buildSetup(ctx: ScreenCtx): Screen {
  const s = store.settings;
  const prof = store.profile;
  let mode: GameModeId = s.lastMode;
  let movement: MovementMode = s.lastMovement;
  let biome: BiomeId = isBiomeUnlocked(prof, s.lastBiome) ? s.lastBiome : 'karesansui';
  let skin = isSkinUnlocked(prof, s.skin) ? s.skin : 'obsidian';
  const level = levelFromXp(prof.xp);

  const bestFor = (m: GameModeId) => (m === 'daily' ? prof.daily[todayKey()] ?? 0 : prof.bests[bestKey(m, biome, movement)] ?? 0);

  // ---------------------------------------------------------------- modes
  const modeCards = new Map<GameModeId, { el: HTMLButtonElement; best: HTMLElement }>();
  const modeGrid = h('div', { class: 'mode-grid', role: 'radiogroup', 'aria-label': 'Game mode' });
  for (const m of MODES) {
    const best = h('span', { class: 'mode-best' });
    const card = h(
      'button',
      { type: 'button', class: `card mode-card mode-${m.id}`, role: 'radio', 'data-sfx': 'toggle' },
      h('span', { class: 'mode-ic' }, icon(ICONS[m.icon])),
      h('span', { class: 'mode-text' }, h('span', { class: 'mode-name' }, m.name), h('span', { class: 'mode-desc' }, m.desc)),
      best,
    );
    card.addEventListener('click', () => {
      mode = m.id;
      store.saveSettings({ lastMode: mode });
      refresh();
    });
    modeCards.set(m.id, { el: card, best });
    modeGrid.appendChild(card);
  }
  const dailyInfo = h('div', { class: 'daily-info' });

  // ---------------------------------------------------------------- biomes
  let realm: Realm = BIOME_BY_ID[biome].realm;
  const track = h('div', { class: 'biome-track', role: 'radiogroup', 'aria-label': 'World' });
  const biomeCards = new Map<BiomeId, HTMLButtonElement>();
  for (const b of BIOMES) {
    const unlocked = isBiomeUnlocked(prof, b.id);
    const beyond = b.realm === 'beyond';
    const card = h(
      'button',
      {
        type: 'button',
        class: `card biome-card${unlocked ? '' : ' locked'}${beyond ? ' realm-beyond' : ''}`,
        'data-realm': b.realm,
        role: 'radio',
        'data-sfx': unlocked ? 'toggle' : 'back',
        'aria-disabled': unlocked ? undefined : 'true',
        'aria-label': unlocked ? `${b.name}, ${b.region}` : `${b.name}, locked. Reach level ${b.unlockLevel}`,
        style: { '--bacc': b.accent },
      },
      h(
        'span',
        { class: 'biome-art', style: { background: b.cardGradient } },
        beyond ? h('span', { class: 'biome-stars', 'aria-hidden': 'true' }) : null,
        h('span', { class: `biome-local${b.localName.length > 9 ? ' long' : ''}` }, b.localName),
        unlocked ? null : h('span', { class: 'biome-lock' }, icon(ICONS.lock), h('span', null, `Reach level ${b.unlockLevel}`)),
      ),
      h(
        'span',
        { class: 'biome-meta' },
        h('span', { class: 'biome-name' }, b.name),
        h('span', { class: 'biome-region' }, b.region),
        h('span', { class: 'biome-tag' }, b.tagline),
      ),
    );
    card.addEventListener('click', () => {
      if (!unlocked) {
        card.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 260 });
        ctx.toast(`${b.name} is locked`, `Reach level ${b.unlockLevel} to travel here. You are level ${level}.`, 'lock');
        return;
      }
      if (biome === b.id) return;
      biome = b.id;
      store.saveSettings({ lastBiome: biome });
      ctx.host.previewBiome(biome);
      ctx.setAccent(biome);
      refresh();
    });
    card.addEventListener('focus', () => card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: ctx.reducedMotion() ? 'auto' : 'smooth' }));
    biomeCards.set(b.id, card);
    track.appendChild(card);
  }
  const scrollBy = (d: number) => track.scrollBy({ left: d * track.clientWidth * 0.7, behavior: ctx.reducedMotion() ? 'auto' : 'smooth' });
  const carousel = h(
    'div',
    { class: 'carousel' },
    btn({ icon: 'prev', cls: 'btn-icon car-arrow car-prev', title: 'Previous worlds', sfx: 'none', attrs: { tabindex: '-1' }, onClick: () => scrollBy(-1) }),
    track,
    btn({ icon: 'next', cls: 'btn-icon car-arrow car-next', title: 'More worlds', sfx: 'none', attrs: { tabindex: '-1' }, onClick: () => scrollBy(1) }),
  );
  const updateArrows = () => {
    const max = track.scrollWidth - track.clientWidth;
    carousel.classList.toggle('can-prev', track.scrollLeft > 4);
    carousel.classList.toggle('can-next', track.scrollLeft < max - 4);
  };
  track.addEventListener('scroll', updateArrows, { passive: true });

  // ---------------------------------------------------------------- realm tabs
  const realmCount = (r: Realm) => {
    const list = BIOMES.filter((b) => b.realm === r);
    return `${list.filter((b) => isBiomeUnlocked(prof, b.id)).length}/${list.length}`;
  };
  const centreOn = (c: HTMLElement | undefined, smooth: boolean) => {
    const left = c ? Math.max(0, c.offsetLeft - (track.clientWidth - c.offsetWidth) / 2) : 0;
    track.scrollTo({ left, behavior: smooth && !ctx.reducedMotion() ? 'smooth' : 'auto' });
  };
  const showRealm = (r: Realm) => {
    realm = r;
    for (const c of biomeCards.values()) c.hidden = c.dataset.realm !== r;
    track.setAttribute('aria-label', r === 'earth' ? 'Worlds on Earth' : 'Worlds beyond Earth');
    carousel.classList.toggle('realm-beyond', r === 'beyond');
    const sel = biomeCards.get(biome);
    centreOn(sel && !sel.hidden ? sel : undefined, false);
    updateArrows();
  };
  const realmTabs = tabs<Realm>(
    [
      { value: 'earth', label: 'Earth', icon: 'globe', count: realmCount('earth') },
      { value: 'beyond', label: 'Beyond Earth', icon: 'planet', count: realmCount('beyond'), cls: 'tab-beyond' },
    ],
    realm,
    (r) => showRealm(r),
    'Realm',
    'seg-sm realm-tabs',
  );
  addEventListener('resize', updateArrows);

  // ---------------------------------------------------------------- movement
  const moveHint = h('div', { class: 'move-hint' });
  const moveSeg = segmented<MovementMode>(
    [
      { value: 'grid', label: 'Grid', icon: 'grid' },
      { value: 'glide', label: 'Glide', icon: 'glide' },
    ],
    movement,
    (v) => {
      movement = v;
      store.saveSettings({ lastMovement: v });
      refresh();
    },
    'seg-lg',
    'Movement',
  );

  // ---------------------------------------------------------------- skin chip
  const sk = SKIN_BY_ID[skin] ?? SKIN_BY_ID.obsidian;
  const kindLabel = sk.kind === 'legend' ? 'Legend' : 'Snake';
  const skinChip = btn(
    { cls: `chip skin-chip${sk.kind === 'legend' ? ' is-legend' : ''}`, title: `${kindLabel}: ${sk.name}. Open the collection`, onClick: () => ctx.go('skins') },
    skinDot(sk),
    h('span', { class: 'chip-body' }, h('span', { class: 'chip-sub' }, kindLabel), h('span', { class: 'chip-top' }, sk.name)),
    h('span', { class: 'chip-caret' }, icon(ICONS.next)),
  );

  // ---------------------------------------------------------------- start
  const startBtn = btn({
    cls: 'btn-primary btn-start',
    label: 'Start',
    icon: 'play',
    sfx: 'start',
    onClick: () => {
      store.saveSettings({ lastMode: mode, lastMovement: movement, lastBiome: biome, skin });
      ctx.host.startGame({ mode, movement, biome, skin });
    },
  });
  const summary = h('div', { class: 'start-summary' });

  function hintText(): string {
    const t = ctx.touch;
    if (movement === 'grid') {
      const how = t ? (store.settings.gridTouch === 'dpad' ? 'Use the on-screen D-pad' : 'Swipe anywhere to turn') : 'Arrow keys or WASD';
      return `Four-way turns at cell centres. ${how}.`;
    }
    const how = t
      ? store.settings.glideTouch === 'halves'
        ? 'Hold the left or right half of the screen to steer'
        : 'Drag anywhere to point the way'
      : store.settings.mouseSteer
        ? 'The head follows your pointer, or use ← → / A D'
        : '← → or A D to steer';
    return `Free analog steering, smooth curves. ${how}.`;
  }

  function refresh() {
    for (const [id, c] of modeCards) {
      const on = id === mode;
      c.el.classList.toggle('on', on);
      c.el.setAttribute('aria-checked', String(on));
      const b = bestFor(id);
      c.best.textContent = id === 'zen' ? (b ? `Best ${fmtInt(b)}` : 'No pressure') : b ? `Best ${fmtInt(b)}` : 'No record yet';
      c.best.classList.toggle('has', b > 0);
    }
    for (const [id, c] of biomeCards) {
      const on = id === biome;
      c.classList.toggle('on', on);
      c.setAttribute('aria-checked', String(on));
    }
    if (mode === 'daily') {
      const tb = prof.daily[todayKey()];
      dailyInfo.replaceChildren(
        icon(ICONS.daily),
        h('span', null, h('b', null, fmtDayShort()), ' · Arcade rules on a board seeded by the date. ', tb ? h('span', { class: 'gold' }, `Today's best ${fmtInt(tb)}`) : "You haven't played today."),
      );
      dailyInfo.hidden = false;
    } else dailyInfo.hidden = true;
    moveHint.replaceChildren(icon(ctx.touch ? ICONS.touch : ICONS.keyboard), h('span', null, hintText()));
    const b = BIOME_BY_ID[biome];
    summary.replaceChildren(h('span', null, MODE_BY_ID[mode].name), h('i', null, '·'), h('span', null, b.name), h('i', null, '·'), h('span', null, movement === 'grid' ? 'Grid' : 'Glide'));
  }
  refresh();

  const body = h(
    'div',
    { class: 'setup-body stagger' },
    h('div', { class: 'panel setup-panel', style: { '--i': '0' } }, sectionTitle('Mode'), modeGrid, dailyInfo),
    h('div', { class: 'panel setup-panel', style: { '--i': '1' } }, sectionTitle('World', h('span', { class: 'muted' }, `Level ${level}`)), h('div', { class: 'realm-row' }, realmTabs.el), carousel),
    h(
      'div',
      { class: 'panel setup-panel setup-move', style: { '--i': '2' } },
      h('div', { class: 'move-col' }, sectionTitle('Movement'), moveSeg, moveHint),
      h('div', { class: 'skin-col' }, sectionTitle('Character'), skinChip),
    ),
  );

  const el = h(
    'section',
    { class: 'screen screen-setup' },
    h('div', { class: 'scrim scrim-bottom' }),
    screenHead(ctx, 'New Run', 'Choose your path'),
    h('div', { class: 'screen-scroll' }, body),
    h('footer', { class: 'screen-foot setup-foot' }, summary, startBtn),
  );

  ctx.setAccent(biome);
  ctx.host.previewBiome(biome);
  for (const c of biomeCards.values()) c.hidden = c.dataset.realm !== realm;
  carousel.classList.toggle('realm-beyond', realm === 'beyond');
  requestAnimationFrame(() => showRealm(realm));

  return {
    el,
    focus: startBtn,
    destroy: () => removeEventListener('resize', updateArrows),
  };
}

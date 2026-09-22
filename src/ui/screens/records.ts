import { h, icon, fmtInt, fmtHours, fmtDayShort, fmtRunTime } from '../dom';
import { ICONS } from '../icons';
import { progress, screenHead, sectionTitle, segmented } from '../widgets';
import type { Screen, ScreenCtx } from '../ctx';
import { store, bestKey, todayKey } from '../../core/storage';
import { BIOMES } from '../../biomes/biomes';
import { levelProgress, MAX_LEVEL } from '../../game/progression';
import { MODES } from './setup';
import type { BiomeId } from '../../types';

export function buildRecords(ctx: ScreenCtx): Screen {
  const prof = store.profile;
  const st = prof.stats;
  let biome: BiomeId = store.settings.lastBiome;

  // ---------------------------------------------------------------- level card
  const p = levelProgress(prof.xp);
  const levelCard = h(
    'div',
    { class: 'rec-level' },
    h('span', { class: 'lvl-medal lvl-medal-lg' }, String(p.level)),
    h(
      'div',
      { class: 'rec-level-body' },
      h('div', { class: 'rec-level-top' }, h('span', null, 'Level ', h('b', null, String(p.level))), h('span', { class: 'muted' }, `${fmtInt(prof.xp)} XP total`)),
      progress(p.level >= MAX_LEVEL ? 1 : p.into / p.need, 'bar-gold'),
      h('div', { class: 'muted small' }, p.level >= MAX_LEVEL ? 'Maximum level reached' : `${fmtInt(p.need - p.into)} XP to level ${p.level + 1}`),
    ),
  );

  const today = prof.daily[todayKey()];
  const dailyDays = Object.keys(prof.daily).length;
  const dailyAll = Math.max(0, ...Object.values(prof.daily));
  const dailyCard = h(
    'div',
    { class: 'rec-daily' },
    h('span', { class: 'chip-ic' }, icon(ICONS.daily)),
    h(
      'div',
      null,
      h('div', { class: 'rec-daily-title' }, 'Daily Seed · ', fmtDayShort()),
      h('div', { class: 'rec-daily-val' }, today ? fmtInt(today) : '—'),
      h('div', { class: 'muted small' }, dailyDays ? `${dailyDays} day${dailyDays > 1 ? 's' : ''} played · best ever ${fmtInt(dailyAll)}` : 'No daily runs yet'),
    ),
  );

  // ---------------------------------------------------------------- bests table
  const table = h('div', { class: 'rec-table', role: 'table' });
  function paintTable() {
    const rows: HTMLElement[] = [
      h('div', { class: 'rt-row rt-head', role: 'row' }, h('span', { role: 'columnheader' }, 'Mode'), h('span', { role: 'columnheader' }, icon(ICONS.grid), 'Grid'), h('span', { role: 'columnheader' }, icon(ICONS.glide), 'Glide')),
    ];
    for (const m of MODES) {
      if (m.id === 'daily') continue;
      const g = prof.bests[bestKey(m.id, biome, 'grid')];
      const gl = prof.bests[bestKey(m.id, biome, 'glide')];
      const cell = (v: number | undefined) => h('span', { class: v ? 'rt-val' : 'rt-val none', role: 'cell' }, v ? fmtInt(v) : '—');
      rows.push(h('div', { class: 'rt-row', role: 'row' }, h('span', { class: 'rt-mode', role: 'rowheader' }, icon(ICONS[m.icon]), m.name), cell(g), cell(gl)));
    }
    table.replaceChildren(...rows);
  }
  paintTable();
  const biomeSeg = segmented<BiomeId>(
    BIOMES.map((b) => ({ value: b.id, label: b.name })),
    biome,
    (v) => {
      biome = v;
      paintTable();
    },
    'seg-wrap seg-sm',
    'World',
  );

  // ---------------------------------------------------------------- lifetime
  const stat = (label: string, value: string, ic?: keyof typeof ICONS) =>
    h('div', { class: 'stat' }, ic ? icon(ICONS[ic]) : null, h('span', { class: 'stat-val' }, value), h('span', { class: 'stat-label' }, label));
  const deaths = st.deathsWall + st.deathsSelf + st.deathsObstacle;
  const lifetime = h(
    'div',
    { class: 'stat-grid' },
    stat('Runs', fmtInt(st.runs), 'retry'),
    stat('Play time', fmtHours(st.playTime), 'clock'),
    stat('Food eaten', fmtInt(st.foodEaten), 'food'),
    stat('Golden food', fmtInt(st.goldenEaten), 'sparkle'),
    stat('Total length', fmtInt(st.totalLength), 'length'),
    stat('Longest snake', fmtInt(st.bestLength), 'snake'),
    stat('Best combo', `×${Math.max(1, st.bestCombo)}`, 'combo'),
    stat('Near misses', fmtInt(st.nearMisses), 'near'),
    stat('Zen time', fmtRunTime(st.zenTime), 'zen'),
    stat('Worlds visited', `${st.biomesPlayed.length} / ${BIOMES.length}`, 'globe'),
  );
  const deathBar = h(
    'div',
    { class: 'death-split' },
    h('div', { class: 'death-title' }, h('span', null, 'Endings'), h('span', { class: 'muted' }, fmtInt(deaths))),
    h(
      'div',
      { class: 'death-bar' },
      deaths
        ? [
            h('span', { class: 'd-wall', style: { flex: String(st.deathsWall) } }),
            h('span', { class: 'd-self', style: { flex: String(st.deathsSelf) } }),
            h('span', { class: 'd-obst', style: { flex: String(st.deathsObstacle) } }),
          ]
        : h('span', { class: 'd-none' }),
    ),
    h(
      'div',
      { class: 'death-legend' },
      h('span', null, h('i', { class: 'd-wall' }), `Walls ${st.deathsWall}`),
      h('span', null, h('i', { class: 'd-self' }), `Self ${st.deathsSelf}`),
      h('span', null, h('i', { class: 'd-obst' }), `Obstacles ${st.deathsObstacle}`),
    ),
  );

  const el = h(
    'section',
    { class: 'screen screen-records' },
    h('div', { class: 'scrim scrim-full' }),
    screenHead(ctx, 'Records', 'Your journey'),
    h(
      'div',
      { class: 'screen-scroll' },
      h(
        'div',
        { class: 'records-layout stagger' },
        h('div', { class: 'panel', style: { '--i': '0' } }, levelCard, dailyCard),
        h('div', { class: 'panel', style: { '--i': '1' } }, sectionTitle('Best scores'), biomeSeg, table),
        h('div', { class: 'panel panel-span', style: { '--i': '2' } }, sectionTitle('Lifetime'), lifetime, deathBar),
      ),
    ),
  );
  return { el, focus: biomeSeg.querySelector<HTMLElement>('.on') };
}

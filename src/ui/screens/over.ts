import { h, icon, fmtInt, fmtRunTime, fmtDayShort } from '../dom';
import { ICONS } from '../icons';
import { btn, progress } from '../widgets';
import type { Screen, ScreenCtx } from '../ctx';
import { BIOME_BY_ID } from '../../biomes/biomes';
import { ACHIEVEMENTS } from '../../game/achievements';
import { levelProgress, xpForLevel as xpToReach } from '../../game/progression';
import { MODE_BY_ID } from './setup';
import type { BiomeId, RunResult, RunStats } from '../../types';

type Cause = RunStats['cause'];

const LINES: Record<Cause, Partial<Record<BiomeId, string>> & { _: string }> = {
  wall: {
    _: 'The edge of the world holds firm.',
    karesansui: 'The garden’s edge holds firm.',
    erg: 'The dunes end where the wind begins.',
    lagoon: 'The reef keeps its boundary.',
    svartsandur: 'Basalt does not bend.',
    salar: 'The horizon was closer than it seemed.',
  },
  self: {
    _: 'You met yourself coming back.',
    karesansui: 'A circle closes. The garden is complete.',
    erg: 'Lost in your own tracks.',
    lagoon: 'The tide of you turned inward.',
    svartsandur: 'Your own fire found you.',
    salar: 'You met your reflection.',
  },
  obstacle: {
    _: 'The stones remember you.',
    karesansui: 'The stones remember you.',
    erg: 'The boulder was here first.',
    lagoon: 'The coral stands unbroken.',
    svartsandur: 'The columns are older than the sagas.',
    salar: 'Salt is patient.',
  },
  timeup: {
    _: 'Time is sand, and it has run.',
    karesansui: 'The bell rings. Lay down the rake.',
    erg: 'The sun sets on the caravan.',
    lagoon: 'The tide has turned.',
    svartsandur: 'The embers cool.',
    salar: 'The sky closes its mirror.',
  },
  quit: {
    _: 'The garden rests.',
    karesansui: 'The garden rests, raked and quiet.',
    erg: 'The wind will finish your drawing.',
    lagoon: 'The waves will keep your story.',
    svartsandur: 'Your scars glow on in the dark.',
    salar: 'Your trail dries in the thin air.',
  },
};

export function causeLine(r: RunResult) {
  const set = LINES[r.stats.cause] ?? LINES.quit;
  return set[r.config.biome] ?? set._;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function buildOver(ctx: ScreenCtx): Screen {
  const r = ctx.result;
  if (!r) {
    const el = h('section', { class: 'screen screen-over' });
    return { el };
  }
  const rm = ctx.reducedMotion();
  const zen = r.config.mode === 'zen';
  const st = r.stats;
  const biome = BIOME_BY_ID[r.config.biome];
  const modeName = MODE_BY_ID[r.config.mode]?.name ?? r.config.mode;

  // ---------------------------------------------------------------- score
  const scoreTarget = zen ? Math.round(st.pattern * 100) : st.score;
  const scoreEl = h('div', { class: 'over-score' }, '0');
  const scoreSuffix = zen ? h('span', { class: 'over-score-unit' }, '%') : null;
  const scoreLabel = h('div', { class: 'over-score-label' }, zen ? 'Garden raked' : 'Score');
  const badge = r.newBest && !zen
    ? h('div', { class: 'best-badge' }, icon(ICONS.star), 'New best')
    : h('div', { class: 'over-best' }, zen ? `Length ${fmtInt(st.length)}` : `Best ${fmtInt(r.best)}`);

  // ---------------------------------------------------------------- stats
  const stat = (label: string, value: string, ic: keyof typeof ICONS) =>
    h('div', { class: 'stat' }, icon(ICONS[ic]), h('span', { class: 'stat-val' }, value), h('span', { class: 'stat-label' }, label));
  const stats = h(
    'div',
    { class: 'stat-grid stat-grid-over' },
    stat('Length', fmtInt(st.length), 'length'),
    stat('Max combo', `×${Math.max(1, st.maxCombo)}`, 'combo'),
    stat('Near misses', fmtInt(st.nearMisses), 'near'),
    stat('Time', fmtRunTime(st.time), 'clock'),
    stat('Food', st.goldenEaten ? `${fmtInt(st.foodEaten)} · ${st.goldenEaten}★` : fmtInt(st.foodEaten), 'food'),
    stat('Pattern', `${Math.round(st.pattern * 100)}%`, 'pattern'),
  );

  // ---------------------------------------------------------------- xp
  const afterTotal = xpToReach(r.levelAfter) + r.xpIntoLevel;
  const beforeTotal = Math.max(0, afterTotal - r.xpGained);
  let startFrac: number;
  if (r.levelBefore === r.levelAfter) startFrac = Math.max(0, (r.xpIntoLevel - r.xpGained) / Math.max(1, r.xpForLevel));
  else {
    const bp = levelProgress(beforeTotal);
    startFrac = bp.level === r.levelBefore ? bp.into / bp.need : 0;
  }
  const endFrac = Math.min(1, r.xpIntoLevel / Math.max(1, r.xpForLevel));
  const lvlNum = h('span', { class: 'lvl-medal' }, String(r.levelBefore));
  const xpBar = progress(startFrac, 'bar-gold bar-xp');
  const xpFill = xpBar.firstElementChild as HTMLElement;
  const xpText = h('span', { class: 'xp-text' }, `+${fmtInt(r.xpGained)} XP`);
  const lvlText = h('span', { class: 'xp-level' }, `Level ${r.levelBefore}`);
  const burst = h('div', { class: 'lvl-burst', 'aria-hidden': 'true' });
  const xpBox = h(
    'div',
    { class: 'over-xp' },
    lvlNum,
    h('div', { class: 'xp-body' }, h('div', { class: 'xp-top' }, lvlText, xpText), xpBar),
    burst,
  );

  // ---------------------------------------------------------------- unlocks & achievements
  const extras: HTMLElement[] = [];
  for (const u of r.unlocks) extras.push(h('li', { class: 'reward reward-unlock' }, icon(ICONS.sparkle), h('span', null, u)));
  for (const id of r.achievements) {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) continue;
    extras.push(h('li', { class: 'reward reward-ach' }, h('span', { class: 'reward-glyph' }, a.icon), h('span', null, h('b', null, a.name), h('small', null, a.description))));
  }
  const rewards = extras.length ? h('ul', { class: 'rewards' }, extras) : null;

  // ---------------------------------------------------------------- buttons
  const retry = btn({ cls: 'btn-primary', label: 'Retry', icon: 'retry', sfx: 'start', onClick: () => ctx.host.restart() });
  const pic = btn({ cls: 'btn-ghost', label: 'Save picture', icon: 'camera', onClick: () => ctx.host.savePicture() });
  const menu = btn({ cls: 'btn-ghost', label: 'Menu', icon: 'menu', sfx: 'back', onClick: () => ctx.host.quitToMenu() });

  const kicker = [modeName, biome?.name, r.config.movement === 'grid' ? 'Grid' : 'Glide'].filter(Boolean).join(' · ');
  const el = h(
    'section',
    { class: `screen screen-over${r.newBest ? ' is-best' : ''}` },
    h('div', { class: 'scrim scrim-dim' }),
    h(
      'div',
      { class: 'panel over-panel stagger', role: 'dialog', 'aria-label': 'Run complete' },
      h(
        'div',
        { class: 'over-main' },
        h('div', { class: 'kicker', style: { '--i': '0' } }, r.config.mode === 'daily' ? `Daily Seed · ${fmtDayShort()}` : kicker),
        h('p', { class: 'over-line', style: { '--i': '0' } }, causeLine(r)),
        h('div', { class: 'over-score-wrap', style: { '--i': '1' } }, scoreLabel, h('div', { class: 'over-score-row' }, scoreEl, scoreSuffix), badge),
        h('div', { style: { '--i': '2' } }, stats),
      ),
      h(
        'div',
        { class: 'over-side' },
        h('div', { style: { '--i': '3' } }, xpBox),
        rewards ? h('div', { class: 'rewards-wrap', style: { '--i': '4' } }, rewards) : null,
        h('div', { class: 'over-actions', style: { '--i': '5' } }, retry, h('div', { class: 'over-actions-sec' }, pic, menu)),
      ),
    ),
  );

  // ---------------------------------------------------------------- animation
  let raf = 0;
  let alive = true;
  const timers: number[] = [];
  const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(() => alive && fn(), ms));

  function countUp() {
    if (rm || scoreTarget <= 0) {
      scoreEl.textContent = fmtInt(scoreTarget);
      return;
    }
    const dur = Math.min(1400, 500 + Math.log10(scoreTarget + 1) * 260);
    const t0 = performance.now();
    const step = (now: number) => {
      if (!alive) return;
      const t = Math.min(1, (now - t0) / dur);
      scoreEl.textContent = fmtInt(scoreTarget * easeOut(t));
      if (t < 1) raf = requestAnimationFrame(step);
      else if (r!.newBest) scoreEl.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
    };
    raf = requestAnimationFrame(step);
  }

  function levelUpFx(level: number) {
    lvlNum.textContent = String(level);
    lvlText.textContent = `Level ${level}`;
    xpBox.classList.add('leveled');
    lvlText.replaceChildren(h('b', { class: 'lvl-up' }, 'Level up!'), ` Level ${level}`);
    if (rm) return;
    burst.replaceChildren();
    for (let i = 0; i < 14; i++) {
      const s = h('i', { style: { '--a': `${(i / 14) * 360}deg` } });
      burst.appendChild(s);
    }
    burst.classList.remove('go');
    void burst.offsetWidth;
    burst.classList.add('go');
    lvlNum.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 520, easing: 'cubic-bezier(.3,1.6,.5,1)' });
  }

  function animateXp() {
    if (rm) {
      xpFill.style.width = `${endFrac * 100}%`;
      if (r!.levelAfter > r!.levelBefore) levelUpFx(r!.levelAfter);
      return;
    }
    const segs: { from: number; to: number; level: number }[] = [];
    for (let L = r!.levelBefore; L <= r!.levelAfter; L++) {
      const from = L === r!.levelBefore ? startFrac : 0;
      const to = L === r!.levelAfter ? endFrac : 1;
      segs.push({ from, to, level: L });
    }
    let i = 0;
    const run = () => {
      if (!alive || i >= segs.length) return;
      const s = segs[i];
      const dur = Math.max(260, 900 * (s.to - s.from));
      xpFill.style.transition = 'none';
      xpFill.style.width = `${s.from * 100}%`;
      void xpFill.offsetWidth;
      xpFill.style.transition = `width ${dur}ms cubic-bezier(.3,.7,.3,1)`;
      xpFill.style.width = `${s.to * 100}%`;
      later(dur + 40, () => {
        i++;
        if (i < segs.length) {
          levelUpFx(segs[i].level);
          later(380, run);
        }
      });
    };
    run();
  }

  later(rm ? 0 : 320, countUp);
  later(rm ? 0 : 1100, animateXp);

  return {
    el,
    focus: retry,
    onBack: () => false,
    destroy: () => {
      alive = false;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    },
  };
}

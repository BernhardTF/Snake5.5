// Reusable UI widgets.
import { h, icon, type Child } from './dom';
import { ICONS, SNAKE_MASK, type IconName } from './icons';
import type { ScreenCtx } from './ctx';
import type { SkinId } from '../types';
import type { SkinInfo } from '../skins/skins';

export interface BtnOpts {
  label?: Child;
  icon?: IconName;
  cls?: string;
  sfx?: 'click' | 'back' | 'start' | 'toggle' | 'none';
  title?: string;
  onClick?: (e: MouseEvent) => void;
  attrs?: Record<string, unknown>;
}

export function btn(o: BtnOpts, ...extra: Child[]): HTMLButtonElement {
  const b = h(
    'button',
    { type: 'button', class: `btn ${o.cls ?? ''}`, 'data-sfx': o.sfx ?? 'click', 'aria-label': o.title, title: o.title, ...(o.attrs ?? {}) },
    o.icon ? icon(ICONS[o.icon]) : null,
    o.label !== undefined ? h('span', { class: 'btn-label' }, o.label) : null,
    ...extra,
  );
  if (o.onClick) b.addEventListener('click', o.onClick);
  return b;
}

/** Standard screen header: back button · title · optional right slot. */
export function screenHead(ctx: ScreenCtx, title: string, kicker?: string, right?: Child): HTMLElement {
  return h(
    'header',
    { class: 'screen-head' },
    btn({ icon: 'back', cls: 'btn-icon btn-back', sfx: 'none', title: 'Back', onClick: () => ctx.back() }),
    h('div', { class: 'head-titles' }, kicker ? h('div', { class: 'kicker' }, kicker) : null, h('h1', { class: 'screen-title' }, title)),
    h('div', { class: 'head-right' }, right ?? null),
  );
}

export function sectionTitle(text: string, aside?: Child) {
  return h('div', { class: 'section-title' }, h('h2', null, text), aside ? h('div', { class: 'section-aside' }, aside) : null);
}

export function progress(frac: number, cls = '') {
  const bar = h('div', { class: `bar ${cls}`, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(frac * 100)) });
  const fill = h('div', { class: 'bar-fill', style: { width: `${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%` } });
  bar.appendChild(fill);
  return bar;
}

// ------------------------------------------------------------------ settings rows

function rowShell(label: string, desc: string | undefined, control: HTMLElement, cls = '') {
  return h(
    'div',
    { class: `row ${cls}` },
    h('div', { class: 'row-text' }, h('div', { class: 'row-label' }, label), desc ? h('div', { class: 'row-desc' }, desc) : null),
    h('div', { class: 'row-control' }, control),
  );
}

export function switchRow(label: string, desc: string | undefined, value: boolean, onChange: (v: boolean) => void) {
  let v = value;
  const sw = h(
    'button',
    { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(v), 'aria-label': label, 'data-sfx': 'toggle' },
    h('span', { class: 'switch-knob' }),
  );
  sw.addEventListener('click', () => {
    v = !v;
    sw.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  const row = rowShell(label, desc, sw, 'row-switch');
  // clicking the text toggles too (big touch target)
  row.querySelector('.row-text')!.addEventListener('click', () => sw.click());
  return row;
}

export interface SegOpt<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export function segmented<T extends string>(opts: SegOpt<T>[], value: T, onChange: (v: T) => void, cls = '', ariaLabel?: string) {
  const wrap = h('div', { class: `seg ${cls}`, role: 'radiogroup', 'aria-label': ariaLabel });
  const buttons: HTMLButtonElement[] = [];
  const set = (v: T) => {
    buttons.forEach((b) => {
      const on = b.dataset.value === v;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('on', on);
    });
  };
  for (const o of opts) {
    const b = h(
      'button',
      { type: 'button', class: 'seg-btn', role: 'radio', 'data-value': o.value, 'data-sfx': 'toggle' },
      o.icon ? icon(ICONS[o.icon]) : null,
      h('span', null, o.label),
    );
    b.addEventListener('click', () => {
      if (b.classList.contains('on')) return;
      set(o.value);
      onChange(o.value);
    });
    buttons.push(b);
    wrap.appendChild(b);
  }
  set(value);
  return wrap;
}

export function segRow<T extends string>(label: string, desc: string | undefined, opts: SegOpt<T>[], value: T, onChange: (v: T) => void) {
  return rowShell(label, desc, segmented(opts, value, onChange, '', label), opts.length > 3 ? 'row-stack' : 'row-seg');
}

export function sliderRow(
  ctx: ScreenCtx,
  label: string,
  desc: string | undefined,
  o: { min: number; max: number; step: number; value: number; fmt: (v: number) => string },
  onInput: (v: number) => void,
) {
  const input = h('input', {
    type: 'range',
    class: 'slider',
    min: String(o.min),
    max: String(o.max),
    step: String(o.step),
    value: String(o.value),
    'aria-label': label,
  }) as HTMLInputElement;
  const out = h('output', { class: 'slider-val' }, o.fmt(o.value));
  const paint = () => {
    const f = (+input.value - o.min) / (o.max - o.min);
    input.style.setProperty('--f', `${(f * 100).toFixed(1)}%`);
  };
  paint();
  let lastSound = 0;
  input.addEventListener('input', () => {
    const v = +input.value;
    out.textContent = o.fmt(v);
    paint();
    onInput(v);
    const now = performance.now();
    if (now - lastSound > 140) {
      lastSound = now;
      ctx.sound('toggle');
    }
  });
  const control = h('div', { class: 'slider-wrap' }, input, out);
  return rowShell(label, desc, control, 'row-slider');
}

// ------------------------------------------------------------------ skin swatch

const SKIN_PATTERNS: Record<SkinId, (s: [string, string, string]) => string> = {
  obsidian: ([b, p]) =>
    `linear-gradient(180deg, transparent 44%, ${p} 46%, #fff3b0 50%, ${p} 54%, transparent 56%), linear-gradient(180deg, #3a342c, ${b} 45%, #0c0b0a)`,
  emerald: ([b, p, bl]) =>
    `radial-gradient(circle at 30% 50%, ${p} 0 2.2px, transparent 3px) 0 0/16px 12px, radial-gradient(circle at 70% 20%, ${p} 0 1.6px, transparent 2.4px) 0 0/22px 14px, linear-gradient(180deg, ${bl} 0%, ${b} 40%, #0d4a1f 100%)`,
  coral: ([b, p, bl]) =>
    `repeating-linear-gradient(90deg, ${b} 0 18px, ${p} 18px 22px, ${bl} 22px 28px, ${p} 28px 32px)`,
  krait: ([b, p, bl]) =>
    `repeating-linear-gradient(90deg, ${b} 0 12px, ${p} 12px 20px), linear-gradient(180deg, ${bl}, ${b})`,
  viper: ([b, p, bl]) =>
    `radial-gradient(ellipse 5px 4px at 50% 50%, ${p} 0 70%, transparent 100%) 0 0/18px 14px, radial-gradient(ellipse 3px 3px at 20% 20%, ${p}aa 0 60%, transparent 100%) 0 0/11px 9px, linear-gradient(180deg, ${bl}, ${b})`,
  albino: ([b, p, bl]) =>
    `radial-gradient(ellipse 8px 6px at 50% 50%, ${p} 0 60%, transparent 100%) 0 0/24px 18px, linear-gradient(180deg, ${bl}, ${b})`,
  rainbow: ([b, p]) =>
    `radial-gradient(circle at 50% 50%, transparent 0 3px, ${p} 3.5px 5px, transparent 5.5px) 0 0/16px 14px, linear-gradient(100deg, #b3542a 0%, #d88a3a 20%, #7fbf8f 38%, #5a7fd8 55%, #b35aa8 72%, #e07a3a 90%)`,
  ember: ([b, p]) =>
    `linear-gradient(115deg, transparent 0 20%, ${p} 21%, transparent 23% 45%, ${p} 46%, #ffd28a 47%, transparent 49% 70%, ${p} 71%, transparent 73%), linear-gradient(60deg, transparent 0 32%, ${p}cc 33%, transparent 35% 60%, ${p}cc 61%, transparent 63%), linear-gradient(180deg, #3a2018, ${b})`,
};

export function skinSwatch(s: SkinInfo, cls = '') {
  const bg = SKIN_PATTERNS[s.id]?.(s.swatch) ?? `linear-gradient(90deg, ${s.swatch.join(',')})`;
  const body = h('div', {
    class: 'swatch-body',
    style: {
      background: `radial-gradient(ellipse 60% 40% at 50% 28%, rgba(255,255,255,.35), transparent 70%), radial-gradient(circle at 50% 50%, rgba(0,0,0,.12) 0 1.5px, transparent 2px) 0 0/6px 5px, ${bg}`,
      '-webkit-mask-image': SNAKE_MASK,
      'mask-image': SNAKE_MASK,
    },
  });
  return h('div', { class: `swatch ${cls}`, 'data-skin': s.id }, h('div', { class: 'swatch-shadow', style: { '-webkit-mask-image': SNAKE_MASK, 'mask-image': SNAKE_MASK } }), body);
}

/** Small round swatch dot (chips). */
export function skinDot(s: SkinInfo) {
  const bg = SKIN_PATTERNS[s.id]?.(s.swatch) ?? s.swatch[0];
  return h('span', { class: 'skin-dot', style: { background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,.45), transparent 55%), ${bg}` } });
}

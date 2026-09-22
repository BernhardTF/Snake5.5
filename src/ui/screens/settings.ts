import { h, icon } from '../dom';
import { ICONS, type IconName } from '../icons';
import { btn, screenHead, sectionTitle, segRow, sliderRow, switchRow } from '../widgets';
import type { Screen, ScreenCtx } from '../ctx';
import { store, type Settings } from '../../core/storage';

type Tab = 'graphics' | 'audio' | 'controls' | 'access' | 'data';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'graphics', label: 'Graphics', icon: 'graphics' },
  { id: 'audio', label: 'Audio', icon: 'audio' },
  { id: 'controls', label: 'Controls', icon: 'controls' },
  { id: 'access', label: 'Access', icon: 'access' },
  { id: 'data', label: 'Data', icon: 'data' },
];

let lastTab: Tab = 'graphics';

export function buildSettings(ctx: ScreenCtx): Screen {
  const set = (patch: Partial<Settings>) => {
    store.saveSettings(patch);
    ctx.host.settingsChanged(store.settings);
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  const panes: Record<Tab, () => HTMLElement[]> = {
    graphics: () => {
      const s = store.settings;
      return [
        segRow(
          'Quality',
          'Auto adapts to your device and keeps the frame rate smooth.',
          [
            { value: 'auto', label: 'Auto' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'ultra', label: 'Ultra' },
          ],
          s.quality,
          (v) => set({ quality: v }),
        ),
        sliderRow(ctx, 'Render scale', 'Lower values are sharper on battery.', { min: 0.5, max: 1, step: 0.05, value: s.renderScale, fmt: pct }, (v) => set({ renderScale: v })),
        switchRow('Bloom', 'Glow on embers, sparkles and aurora.', s.bloom, (v) => set({ bloom: v })),
        switchRow('Depth of field', 'Tilt-shift blur for a miniature look.', s.dof, (v) => set({ dof: v })),
        switchRow('Particles', 'Drifting sand, petals and embers.', s.particles, (v) => set({ particles: v })),
        switchRow('Show FPS', 'A small frame counter in the corner.', s.showFps, (v) => set({ showFps: v })),
      ];
    },
    audio: () => {
      const s = store.settings;
      return [
        sliderRow(ctx, 'Master volume', undefined, { min: 0, max: 1, step: 0.05, value: s.masterVolume, fmt: pct }, (v) => set({ masterVolume: v })),
        sliderRow(ctx, 'Music', 'Generative score for each world.', { min: 0, max: 1, step: 0.05, value: s.musicVolume, fmt: pct }, (v) => set({ musicVolume: v })),
        sliderRow(ctx, 'Sound effects', undefined, { min: 0, max: 1, step: 0.05, value: s.sfxVolume, fmt: pct }, (v) => set({ sfxVolume: v })),
        switchRow('Mute all', undefined, s.muted, (v) => set({ muted: v })),
      ];
    },
    controls: () => {
      const s = store.settings;
      return [
        segRow('Grid touch', 'How you turn in Classic Grid on a touch screen.', [{ value: 'swipe', label: 'Swipe' }, { value: 'dpad', label: 'D-pad' }], s.gridTouch, (v) => set({ gridTouch: v })),
        segRow('Glide touch', 'How you steer in Free Glide on a touch screen.', [{ value: 'drag', label: 'Drag' }, { value: 'halves', label: 'Halves' }], s.glideTouch, (v) => set({ glideTouch: v })),
        sliderRow(ctx, 'Swipe sensitivity', 'Shorter swipes register at higher values.', { min: 0.5, max: 2, step: 0.1, value: s.swipeSensitivity, fmt: (v) => `${v.toFixed(1)}×` }, (v) => set({ swipeSensitivity: v })),
        switchRow('Mouse steering', 'In Free Glide the head follows your pointer.', s.mouseSteer, (v) => set({ mouseSteer: v })),
        switchRow('Haptics', 'Vibrate on eating and on death (where supported).', s.haptics, (v) => set({ haptics: v })),
        keyRef(),
      ];
    },
    access: () => {
      const s = store.settings;
      return [
        switchRow('Reduced motion', 'Turns off camera shake and non-essential animation.', s.reducedMotion, (v) => set({ reducedMotion: v })),
        switchRow('High-contrast food', 'Food and power-ups get a bold outline.', s.highContrastFood, (v) => set({ highContrastFood: v })),
        switchRow('Larger HUD', 'Scales the score, combo and timers by 125%.', s.largeHud, (v) => set({ largeHud: v })),
      ];
    },
    data: () => [
      h(
        'div',
        { class: 'row row-stack' },
        h(
          'div',
          { class: 'row-text' },
          h('div', { class: 'row-label' }, 'Reset progress'),
          h('div', { class: 'row-desc' }, 'Erases level, XP, records, achievements and unlocks on this device. Settings are kept.'),
        ),
        h(
          'div',
          { class: 'row-control' },
          btn({
            cls: 'btn-danger',
            label: 'Reset progress…',
            icon: 'reset',
            onClick: async () => {
              const ok = await ctx.confirm({
                title: 'Reset all progress?',
                body: 'Your level, records, achievements and unlocked worlds and snakes will be erased. This cannot be undone.',
                ok: 'Reset',
                cancel: 'Keep my progress',
                danger: true,
              });
              if (ok) {
                store.resetProgress();
                ctx.toast('Progress reset', 'A fresh garden awaits.', 'reset');
              }
            },
          }),
        ),
      ),
      h('p', { class: 'fine' }, 'Everything is stored locally in your browser. Nothing leaves your device.'),
    ],
  };

  const tabButtons = new Map<Tab, HTMLButtonElement>();
  const tabBar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Settings sections' });
  const pane = h('div', { class: 'tab-pane', role: 'tabpanel' });

  function select(t: Tab, animate = true) {
    lastTab = t;
    for (const [id, b] of tabButtons) {
      const on = id === t;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    const info = TABS.find((x) => x.id === t)!;
    pane.replaceChildren(sectionTitle(info.label), ...panes[t]());
    if (animate && !ctx.reducedMotion()) pane.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }

  for (const t of TABS) {
    const b = h('button', { type: 'button', class: 'tab', role: 'tab', 'data-sfx': 'toggle', 'data-tab': t.id }, icon(ICONS[t.icon]), h('span', null, t.label));
    b.addEventListener('click', () => select(t.id));
    tabButtons.set(t.id, b);
    tabBar.appendChild(b);
  }
  select(lastTab, false);

  const el = h(
    'section',
    { class: 'screen screen-settings' },
    h('div', { class: 'scrim scrim-full' }),
    screenHead(ctx, 'Settings', ctx.from === 'pause' ? 'Paused' : 'Preferences'),
    h('div', { class: 'screen-scroll' }, h('div', { class: 'panel settings-panel' }, tabBar, pane)),
  );
  return { el, focus: tabButtons.get(lastTab) };
}

function keyRef() {
  const k = (...keys: string[]) => h('span', { class: 'keys' }, ...keys.map((x) => h('kbd', null, x)));
  const r = (what: string, kb: HTMLElement, pad: HTMLElement) => h('div', { class: 'kr-row' }, h('span', { class: 'kr-what' }, what), kb, pad);
  return h(
    'div',
    { class: 'keyref' },
    h('div', { class: 'kr-row kr-head' }, h('span', null, ''), h('span', null, icon(ICONS.keyboard), 'Keyboard'), h('span', null, icon(ICONS.controls), 'Gamepad')),
    r('Turn (Grid)', k('← ↑ → ↓', 'WASD'), k('D-pad', 'L-stick')),
    r('Steer (Glide)', k('← →', 'A D'), k('L-stick')),
    r('Pause', k('Esc', 'P'), k('Start')),
    r('Menus', k('Arrows', 'Enter'), k('D-pad', 'A')),
    r('Back', k('Esc'), k('B')),
  );
}

// Line icons, 24×24, drawn in "ink" strokes (currentColor).
const I = (d: string, sw = 1.6) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;

export const ICONS = {
  back: I('<path d="M14.5 5.5L8 12l6.5 6.5"/>', 1.8),
  next: I('<path d="M9.5 5.5L16 12l-6.5 6.5"/>', 1.8),
  prev: I('<path d="M14.5 5.5L8 12l6.5 6.5"/>', 1.8),
  pause: I('<path d="M9 6.5v11M15 6.5v11"/>', 2.4),
  play: I('<path d="M8.5 5.8v12.4L18.6 12z" fill="currentColor" stroke-width="1.2"/>'),
  snake: I('<path d="M3.5 18.5c3 0 4-1.6 4-4.2S8.7 9 11.2 9s3.8 2 3.8 4.3-.2 3.2 1.4 3.2"/><path d="M16.4 16.5c.6-1.2 2-1.9 3.1-1.4 1.3.6 1.4 2.4.2 3.1-1 .6-2.4.3-3.3-.5"/><path d="M11.2 9V5.5" opacity=".0"/>'),
  trophy: I('<path d="M8 4.5h8v4.8a4 4 0 0 1-8 0z"/><path d="M8 6.5H5.2a2.8 2.8 0 0 0 3.1 3.6M16 6.5h2.8a2.8 2.8 0 0 1-3.1 3.6M12 13.3v3.2M9 20h6M10 16.5h4v3.5h-4z"/>'),
  records: I('<path d="M5 19.5v-7M10 19.5V5M15 19.5v-10M20 19.5v-4"/><path d="M3.5 19.5h18" opacity=".5"/>'),
  settings: I('<path d="M4 7h9M18 7h2M4 17h3M12 17h8"/><circle cx="15.5" cy="7" r="2.3"/><circle cx="9.5" cy="17" r="2.3"/>'),
  credits: I('<path d="M19.5 4.5C12 4.5 7.5 9.5 6.8 16.5L5 20"/><path d="M19.5 4.5c0 6.8-4.6 11.5-12.4 12"/><path d="M9.6 12.2h5.2M12 8.8h4.8"/>'),
  lock: I('<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
  check: I('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2),
  classic: I('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/>'),
  arcade: I('<path d="M13.2 3L5.5 13.5H12L10.8 21l7.7-10.5H12z"/>'),
  zen: I('<path d="M18.6 8.2A7.6 7.6 0 1 0 19.2 14" stroke-width="2.1"/>'),
  timeattack: I('<circle cx="12" cy="13.2" r="7"/><path d="M12 9.2v4.2l2.8 1.8M9.8 3.2h4.4M12 3.2v3"/>'),
  daily: I('<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.5 5.5l1.5 1.5M17 17l1.5 1.5M5.5 18.5L7 17M17 7l1.5-1.5"/>'),
  grid: I('<path d="M5 19.5V11h7.5V4.5H19"/><circle cx="19" cy="4.5" r="1.3" fill="currentColor"/>'),
  glide: I('<path d="M3.5 17c4.5 0 4-9 8.5-9s4 7 8.5 1.5"/><circle cx="20.5" cy="9.5" r="1.3" fill="currentColor"/>'),
  slow: I('<path d="M7 3.5h10M7 20.5h10M8 3.5c0 5 8 4.5 8 8.5s-8 3.5-8 8.5M16 3.5c0 5-8 4.5-8 8.5s8 3.5 8 8.5"/>'),
  ghost: I('<path d="M6 20V11a6 6 0 0 1 12 0v9l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4z"/><circle cx="10" cy="11" r=".9" fill="currentColor"/><circle cx="14" cy="11" r=".9" fill="currentColor"/>'),
  magnet: I('<path d="M6 4.5v7a6 6 0 0 0 12 0v-7h-3.6v7a2.4 2.4 0 0 1-4.8 0v-7z"/><path d="M6 8.3h3.6M14.4 8.3H18"/>'),
  double: I('<path d="M4.5 8.5l5.5 7M10 8.5l-5.5 7"/><path d="M13.5 10a2.6 2.6 0 0 1 5.2.3c0 2.3-5.2 3.4-5.2 5.2h5.4"/>'),
  camera: I('<path d="M4 8.5h3.2L8.8 6h6.4l1.6 2.5H20V19H4z"/><circle cx="12" cy="13.5" r="3.4"/>'),
  retry: I('<path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M5 4.5V9h4.5"/>'),
  menu: I('<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>'),
  close: I('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  graphics: I('<path d="M3 17.5l5.5-7 4 5 2.5-3 6 5"/><circle cx="16.5" cy="7" r="2"/>'),
  audio: I('<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 6.8a7.4 7.4 0 0 1 0 10.4"/>'),
  controls: I('<path d="M7.2 7.5h9.6a4 4 0 0 1 4 4.4l-.5 4.2a2 2 0 0 1-3.5 1L15 15H9l-1.8 2.1a2 2 0 0 1-3.5-1l-.5-4.2a4 4 0 0 1 4-4.4z"/><path d="M8 10.3v3.4M6.3 12h3.4"/><circle cx="15.8" cy="11" r=".7" fill="currentColor"/><circle cx="17.6" cy="13" r=".7" fill="currentColor"/>'),
  access: I('<circle cx="12" cy="4.6" r="1.6"/><path d="M5 8.4l7 1.6 7-1.6M12 10v4.6M12 14.6L9 20.5M12 14.6l3 5.9"/>'),
  data: I('<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6"/>'),
  star: I('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
  length: I('<path d="M4 16.5c2.5 0 3-5 5.5-5s2.5 5 5 5 3-5 5.5-5"/>'),
  combo: I('<path d="M12 3c1 3.5 5 5.2 5 10a5 5 0 0 1-10 0c0-2.4 1.3-3.6 2.4-4.8.3 1.6 1.1 2.4 2 2.6C11.4 8 11.3 5.5 12 3z"/>'),
  near: I('<path d="M4 12h5M15 12h5"/><path d="M9 8.5L12 12l-3 3.5M15 8.5L12 12l3 3.5"/>'),
  food: I('<path d="M12 7.5c-2-3-6-2-6 1.5 0 4.5 6 9.5 6 9.5s6-5 6-9.5c0-3.5-4-4.5-6-1.5z"/>'),
  clock: I('<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>'),
  pattern: I('<path d="M4 7c2.7-2 5.3-2 8 0s5.3 2 8 0M4 12c2.7-2 5.3-2 8 0s5.3 2 8 0M4 17c2.7-2 5.3-2 8 0s5.3 2 8 0"/>'),
  keyboard: I('<rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M7 10h.01M10.3 10h.01M13.7 10h.01M17 10h.01M7.5 14h9"/>'),
  touch: I('<path d="M9 11V5.8a1.8 1.8 0 0 1 3.6 0V11l4.2.8a2 2 0 0 1 1.6 2.2L18 19.5H10l-3.4-4.3a1.6 1.6 0 0 1 2.4-2.1L9 13"/>'),
  reset: I('<path d="M5 7h14M9.5 7V4.8h5V7M7 7l.8 12.5h8.4L17 7"/>'),
  globe: I('<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4M12 3.8c2.4 2.5 3.4 5.2 3.4 8.2s-1 5.7-3.4 8.2c-2.4-2.5-3.4-5.2-3.4-8.2s1-5.7 3.4-8.2z"/>'),
  planet: I('<circle cx="12" cy="12" r="5.6"/><path d="M6.9 14.3C3.6 16.2 2.3 18 2.9 19c1 1.7 7.3-.4 12.6-3.4S22.1 7.3 21.1 5.6c-.6-1-2.8-.8-5.9.6"/>'),
  crown: I('<path d="M4 17.5L3 8l5 4 4-6.5 4 6.5 5-4-1 9.5z"/><path d="M4.5 20h15"/>'),
  sparkle: I('<path d="M12 3.5l1.7 5.3a2.5 2.5 0 0 0 1.5 1.5l5.3 1.7-5.3 1.7a2.5 2.5 0 0 0-1.5 1.5L12 20.5l-1.7-5.3a2.5 2.5 0 0 0-1.5-1.5L3.5 12l5.3-1.7a2.5 2.5 0 0 0 1.5-1.5z"/>'),
};

export type IconName = keyof typeof ICONS;

/** Snake silhouette used as a CSS mask for skin swatches. */
export const SNAKE_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 90"><path d="M14 66 C 38 66, 44 22, 74 22 S 108 68, 136 66 S 160 34, 176 36" fill="none" stroke="#000" stroke-width="19" stroke-linecap="round"/><ellipse cx="182" cy="36" rx="15" ry="11.5" fill="#000" transform="rotate(-8 182 36)"/><path d="M2 68 C 8 67, 12 66.5, 16 66" fill="none" stroke="#000" stroke-width="9" stroke-linecap="round"/></svg>',
)}")`;

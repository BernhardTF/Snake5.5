// Tiny DOM helpers for the UI layer (no framework).

export type Child = Node | string | number | null | undefined | false | Child[];
export type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) applyProps(el, props);
  append(el, children);
  return el;
}

function applyProps(el: HTMLElement, props: Props) {
  for (const k in props) {
    const v = props[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'style') {
      if (typeof v === 'string') el.style.cssText = v;
      else for (const s in v as Record<string, string>) el.style.setProperty(s, (v as Record<string, string>)[s]);
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
}

export function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/** Element from an SVG/HTML string (first element). */
export function frag(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

export function icon(svg: string, cls = 'ic'): HTMLElement {
  const s = h('span', { class: cls, 'aria-hidden': 'true', html: svg });
  return s;
}

// ------------------------------------------------------------------ formatting

const nf = new Intl.NumberFormat('en-US');
export const fmtInt = (n: number) => nf.format(Math.round(n));

/** m:ss */
export function fmtClock(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** m:ss for run durations (floor). */
export function fmtRunTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** h:mm for lifetime play time. */
export function fmtHours(sec: number) {
  const m = Math.floor(Math.max(0, sec) / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

export function fmtDate(ms: number | Date) {
  const d = typeof ms === 'number' ? new Date(ms) : ms;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDayShort(d = new Date()) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const isTouchDevice = () =>
  typeof matchMedia !== 'undefined' && (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0) &&
  !matchMedia('(pointer: fine)').matches;

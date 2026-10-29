type AttrValue = string | number | boolean | null | undefined;
type Attrs = Record<string, AttrValue | ((event: never) => void)>;
type Child = Node | string | null | undefined | false;

/** Tiny element builder: h('button', { class: 'x', onclick }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (typeof value === 'function') {
        el.addEventListener(key.slice(2), value as EventListener);
      } else if (value === true) {
        el.setAttribute(key, '');
      } else if (value !== false && value !== null && value !== undefined) {
        el.setAttribute(key === 'className' ? 'class' : key, String(value));
      }
    }
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}

const ICONS: Record<string, string> = {
  swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  system: '<rect x="3.5" y="5" width="17" height="11" rx="1.5"/><path d="M9 20h6M12 16v4"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  dark: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  open: '<path d="M12 15V4M8 8l4-4 4 4M5 14v5h14v-5"/>',
  clear: '<path d="M6 6l12 12M18 6L6 18"/>',
  prev: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

export function icon(name: keyof typeof ICONS | string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  svg.innerHTML = ICONS[name] ?? '';
  return svg;
}

export function formatCount(n: number): string {
  return n.toLocaleString();
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

let announcer: HTMLElement | null = null;

/** Speak a short status message to screen readers and show it as a toast. */
export function announce(message: string): void {
  announcer ??= document.getElementById('toast');
  if (!announcer) return;
  announcer.textContent = message;
  announcer.classList.remove('is-visible');
  void announcer.offsetWidth;
  announcer.classList.add('is-visible');
}

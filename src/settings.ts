import type { DiffOptions, Granularity } from './diff/types';

export type Layout = 'unified' | 'split';
export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings extends DiffOptions {
  layout: Layout;
  /** Unchanged paragraphs shown around each change; -1 shows everything. */
  context: number;
  theme: ThemePref;
  draftsHidden: boolean;
}

export const CONTEXT_CHOICES = [0, 1, 2, 3, 5, 10, -1] as const;
export const GRANULARITIES: Granularity[] = ['paragraph', 'word', 'char'];
export const GRANULARITY_LABEL: Record<Granularity, string> = { paragraph: 'Paragraph', word: 'Word', char: 'Character' };

export const DEFAULTS: Settings = {
  layout: 'split',
  granularity: 'word',
  ignoreWhitespace: false,
  ignoreCase: false,
  ignoreBlankLines: true,
  normalizeQuotes: true,
  context: 2,
  theme: 'system',
  draftsHidden: false,
};

/** Only view settings live here. Draft text is never written to storage. */
export const STORAGE_KEY = 'redline:settings:v1';

function sanitize(raw: unknown): Settings {
  const s: Settings = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  if (r.layout === 'unified' || r.layout === 'split') s.layout = r.layout;
  if (GRANULARITIES.includes(r.granularity as Granularity)) s.granularity = r.granularity as Granularity;
  if (r.theme === 'system' || r.theme === 'light' || r.theme === 'dark') s.theme = r.theme;
  if ((CONTEXT_CHOICES as readonly unknown[]).includes(r.context)) s.context = r.context as number;
  for (const key of ['ignoreWhitespace', 'ignoreCase', 'ignoreBlankLines', 'normalizeQuotes', 'draftsHidden'] as const) {
    if (typeof r[key] === 'boolean') s[key] = r[key];
  }
  return s;
}

type Listener = (next: Settings, changed: Array<keyof Settings>) => void;

export class SettingsStore {
  private value: Settings;
  private listeners = new Set<Listener>();

  constructor() {
    let stored: unknown = null;
    try {
      stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    } catch {
      // Storage blocked or corrupt: fall back to defaults.
    }
    this.value = sanitize(stored);
  }

  get(): Settings {
    return this.value;
  }

  set(patch: Partial<Settings>): void {
    const changed = (Object.keys(patch) as Array<keyof Settings>).filter((k) => patch[k] !== this.value[k]);
    if (changed.length === 0) return;
    this.value = { ...this.value, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.value));
    } catch {
      // Private mode or storage full: settings just won't persist.
    }
    for (const fn of this.listeners) fn(this.value, changed);
  }

  subscribe(fn: Listener): void {
    this.listeners.add(fn);
  }
}

export function diffOptions(s: Settings): DiffOptions {
  return {
    granularity: s.granularity,
    ignoreWhitespace: s.ignoreWhitespace,
    ignoreCase: s.ignoreCase,
    ignoreBlankLines: s.ignoreBlankLines,
    normalizeQuotes: s.normalizeQuotes,
  };
}

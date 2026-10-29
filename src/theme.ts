import type { ThemePref } from './settings';

const ORDER: ThemePref[] = ['system', 'light', 'dark'];

export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
}

export function nextTheme(pref: ThemePref): ThemePref {
  return ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
}

export const THEME_LABEL: Record<ThemePref, string> = { system: 'System', light: 'Light', dark: 'Dark' };

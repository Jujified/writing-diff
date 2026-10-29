import '@fontsource-variable/literata/opsz.css';
import '@fontsource-variable/literata/opsz-italic.css';
import '@fontsource-variable/schibsted-grotesk/index.css';
import '@fontsource-variable/spline-sans-mono/index.css';
import './styles/tokens.css';
import './styles/app.css';

import { DiffClient } from './diff/client';
import type { DiffResult, DiffStats } from './diff/types';
import { GRANULARITIES, GRANULARITY_LABEL, SettingsStore, diffOptions, type Layout, type Settings } from './settings';
import { bindShortcuts } from './shortcuts';
import { THEME_LABEL, applyTheme, nextTheme } from './theme';
import { DiffView, type NavState } from './ui/diffView';
import { announce, formatCount, h, icon, plural } from './ui/dom';
import { Pane } from './ui/pane';
import { SettingsPanel, helpDialog } from './ui/settingsPanel';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

const store = new SettingsStore();
applyTheme(store.get().theme);

const DIFF_KEYS: Array<keyof Settings> = ['granularity', 'ignoreWhitespace', 'ignoreCase', 'ignoreBlankLines', 'normalizeQuotes'];
const narrow = window.matchMedia('(max-width: 767px)');
const effectiveLayout = (): Layout => (narrow.matches ? 'unified' : store.get().layout);

/* ---- Drafts ------------------------------------------------------------ */

const paneA = new Pane('a', 'Original', () => schedule());
const paneB = new Pane('b', 'Revised', () => schedule());
const swapButton = h(
  'button',
  { type: 'button', class: 'swap-btn', 'aria-label': 'Swap Original and Revised', title: 'Swap sides (s)', onclick: () => swap() },
  icon('swap'),
);
$('drafts').append(paneA.el, h('div', { class: 'swap-col' }, swapButton), paneB.el);

/* ---- Masthead tools ---------------------------------------------------- */

const settingsPanel = new SettingsPanel(store);
const help = helpDialog();
document.body.append(settingsPanel.dialog, help);

const themeButton = h('button', { type: 'button', class: 'icon-btn', onclick: () => cycleTheme() });
const refreshThemeButton = () => {
  const t = store.get().theme;
  themeButton.replaceChildren(icon(t));
  const label = `Theme: ${THEME_LABEL[t]}. Switch to ${THEME_LABEL[nextTheme(t)]}.`;
  themeButton.setAttribute('aria-label', label);
  themeButton.title = label;
};
refreshThemeButton();

$('masthead-tools').append(
  themeButton,
  h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Keyboard shortcuts', title: 'Keyboard shortcuts (?)', onclick: () => toggleHelp() }, icon('keyboard')),
  h(
    'button',
    { type: 'button', class: 'btn btn--quiet', 'aria-haspopup': 'dialog', title: 'View settings (,)', onclick: () => settingsPanel.open() },
    icon('settings'),
    h('span', null, 'Settings'),
  ),
);

/* ---- Summary bar ------------------------------------------------------- */

const statAdded = h('span', { class: 'stat stat--ins' });
const statRemoved = h('span', { class: 'stat stat--del' });
const statParas = h('span', { class: 'stat stat--paras' });
const busy = h('span', { class: 'busy', hidden: true }, 'Comparing…');
const navLabel = h('span', { class: 'nav-label', 'aria-live': 'polite' });
const prevButton = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous change', title: 'Previous change (p)', onclick: () => view.prev() }, icon('up'));
const nextButton = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next change', title: 'Next change (n)', onclick: () => view.next() }, icon('down'));

function segmented<T extends string>(label: string, options: Array<[T, string]>, onPick: (v: T) => void) {
  const buttons = options.map(([value, text]) =>
    h('button', { type: 'button', class: 'seg', 'aria-pressed': 'false', 'data-value': value, onclick: () => onPick(value) }, text),
  );
  const el = h('div', { class: 'segmented', role: 'group', 'aria-label': label }, ...buttons);
  const set = (value: T, disabled = false) => {
    for (const b of buttons) {
      b.setAttribute('aria-pressed', String(b.dataset.value === value));
      b.disabled = disabled;
    }
  };
  return { el, set };
}

const layoutControl = segmented<Layout>('Layout', [['split', 'Side by side'], ['unified', 'Unified']], (layout) => store.set({ layout }));
const granControl = segmented('Compare by', GRANULARITIES.map((g) => [g, GRANULARITY_LABEL[g]] as [typeof g, string]), (granularity) =>
  store.set({ granularity }),
);
const draftsToggle = h('button', { type: 'button', class: 'btn btn--quiet drafts-toggle', 'aria-controls': 'drafts', onclick: () => store.set({ draftsHidden: !store.get().draftsHidden }) });

$('summary').append(
  h('div', { class: 'summary-stats' }, statAdded, statRemoved, statParas, busy),
  h('div', { class: 'summary-view' }, layoutControl.el, granControl.el),
  h('div', { class: 'summary-nav' }, prevButton, navLabel, nextButton, draftsToggle),
);

function showStats(stats: DiffStats | null): void {
  statAdded.replaceChildren(h('b', null, `+${formatCount(stats?.wordsAdded ?? 0)}`), ` ${(stats?.wordsAdded ?? 0) === 1 ? 'word' : 'words'} added`);
  statRemoved.replaceChildren(h('b', null, `−${formatCount(stats?.wordsRemoved ?? 0)}`), ` ${(stats?.wordsRemoved ?? 0) === 1 ? 'word' : 'words'} removed`);
  statParas.textContent = `${plural(stats?.paragraphsChanged ?? 0, 'paragraph')} changed`;
  $('summary').classList.toggle('is-idle', stats === null);
}

function showNav({ current, total }: NavState): void {
  navLabel.textContent = total === 0 ? 'No changes' : current < 0 ? plural(total, 'change') : `${current + 1} of ${formatCount(total)}`;
  prevButton.disabled = total === 0 || current <= 0;
  nextButton.disabled = total === 0 || current >= total - 1;
}

/* ---- Diff -------------------------------------------------------------- */

const view = new DiffView($('scroller'), $('rail'), $('rail-thumb'), showNav);
let lastResult: DiffResult | null = null;
let busyTimer = 0;

const client = new DiffClient(
  (result, error) => {
    if (!result) {
      view.showError(error ?? 'Something went wrong while comparing.');
      showStats(null);
      return;
    }
    lastResult = result;
    view.setResult(result, store.get(), effectiveLayout());
    showStats(result.stats);
  },
  (isBusy) => {
    window.clearTimeout(busyTimer);
    // Only show the indicator for slow diffs, so fast ones don't flicker.
    if (isBusy) busyTimer = window.setTimeout(() => (busy.hidden = false), 200);
    else busy.hidden = true;
  },
);

function schedule(delay = 250): void {
  const hasA = paneA.text.trim() !== '';
  const hasB = paneB.text.trim() !== '';
  if (!hasA || !hasB) {
    client.cancel();
    lastResult = null;
    view.showEmpty(!hasA && !hasB ? 'both' : !hasA ? 'a' : 'b');
    showStats(null);
    return;
  }
  client.request(paneA.text, paneB.text, diffOptions(store.get()), delay);
}

function rerender(): void {
  if (lastResult) view.setResult(lastResult, store.get(), effectiveLayout());
}

/* ---- Settings reactions ------------------------------------------------ */

function reflectSettings(s: Settings): void {
  layoutControl.set(narrow.matches ? 'unified' : s.layout, narrow.matches);
  layoutControl.el.title = narrow.matches ? 'Side by side needs a wider window' : '';
  granControl.set(s.granularity);
  document.body.classList.toggle('drafts-hidden', s.draftsHidden);
  draftsToggle.textContent = s.draftsHidden ? 'Show drafts' : 'Hide drafts';
  draftsToggle.setAttribute('aria-expanded', String(!s.draftsHidden));
  $('drafts').hidden = s.draftsHidden;
  refreshThemeButton();
}

store.subscribe((s, changed) => {
  reflectSettings(s);
  if (changed.includes('theme')) applyTheme(s.theme);
  if (changed.some((k) => DIFF_KEYS.includes(k))) schedule(0);
  else if (changed.includes('layout') || changed.includes('context')) rerender();
});
narrow.addEventListener('change', () => {
  reflectSettings(store.get());
  rerender();
});

/* ---- Actions ----------------------------------------------------------- */

function swap(): void {
  const a = paneA.snapshot();
  paneA.restore(paneB.snapshot());
  paneB.restore(a);
  schedule(0);
  announce('Swapped Original and Revised');
}

function cycleTheme(): void {
  const theme = nextTheme(store.get().theme);
  store.set({ theme });
  announce(`Theme: ${THEME_LABEL[theme]}`);
}

function toggleHelp(): void {
  if (help.open) help.close();
  else {
    settingsPanel.close();
    help.showModal();
  }
}

bindShortcuts({
  n: () => (view.hasChanges ? view.next() : announce('No changes to move between')),
  p: () => (view.hasChanges ? view.prev() : announce('No changes to move between')),
  u: () => {
    if (narrow.matches) return announce('Side by side needs a wider window');
    const layout: Layout = store.get().layout === 'split' ? 'unified' : 'split';
    store.set({ layout });
    announce(layout === 'split' ? 'Side by side' : 'Unified');
  },
  g: () => {
    const g = GRANULARITIES[(GRANULARITIES.indexOf(store.get().granularity) + 1) % GRANULARITIES.length];
    store.set({ granularity: g });
    announce(`Compare by ${GRANULARITY_LABEL[g].toLowerCase()}`);
  },
  s: () => swap(),
  ',': () => settingsPanel.toggleOpen(),
  '?': () => toggleHelp(),
});

reflectSettings(store.get());
showStats(null);
schedule(0);

import { CONTEXT_CHOICES, GRANULARITIES, GRANULARITY_LABEL, type Settings, type SettingsStore } from '../settings';
import { THEME_LABEL } from '../theme';
import { h, icon } from './dom';

type Option<T> = { value: T; label: string; hint?: string };

/** A settings drawer built on <dialog>, so focus trapping and Esc come free. */
export class SettingsPanel {
  readonly dialog: HTMLDialogElement;
  private sync: Array<(s: Settings) => void> = [];

  constructor(private readonly store: SettingsStore) {
    const contextOptions: Option<number>[] = CONTEXT_CHOICES.map((n) => ({ value: n, label: n < 0 ? 'All' : String(n) }));

    this.dialog = h(
      'dialog',
      { class: 'drawer', id: 'settings', 'aria-labelledby': 'settings-title' },
      h(
        'div',
        { class: 'drawer-head' },
        h('h2', { id: 'settings-title' }, 'View settings'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close settings', onclick: () => this.close() }, icon('close')),
      ),
      h(
        'div',
        { class: 'drawer-body' },
        this.radios('Layout', 'layout', [
          { value: 'split', label: 'Side by side', hint: 'Original and Revised in aligned columns. Needs a tablet-width window or wider.' },
          { value: 'unified', label: 'Unified', hint: 'One column, like git diff, with edits marked inline.' },
        ]),
        this.radios(
          'Compare by',
          'granularity',
          GRANULARITIES.map((g) => ({
            value: g,
            label: GRANULARITY_LABEL[g],
            hint: { paragraph: 'Mark whole paragraphs as replaced.', word: 'Highlight the words that changed.', char: 'Highlight individual letters — good for typos.' }[g],
          })),
        ),
        this.radios('Unchanged paragraphs around each change', 'context', contextOptions, true),
        h(
          'fieldset',
          { class: 'field' },
          h('legend', null, 'Ignore'),
          this.toggle('ignoreWhitespace', 'Whitespace changes', 'Extra spaces and tabs.'),
          this.toggle('ignoreCase', 'Capitalization', '“The” and “the” count as the same.'),
          this.toggle('ignoreBlankLines', 'Blank-line changes', 'Adding or removing empty lines between paragraphs.'),
          this.toggle('normalizeQuotes', 'Curly vs. straight quotes', 'Treat “ ” ‘ ’ as " and \'.'),
        ),
        this.radios(
          'Theme',
          'theme',
          (['system', 'light', 'dark'] as const).map((t) => ({ value: t, label: THEME_LABEL[t] })),
          true,
        ),
        h('p', { class: 'drawer-foot' }, 'Settings are saved in this browser. Your drafts never are.'),
      ),
    );
    this.dialog.addEventListener('click', (e) => {
      // A click on the backdrop lands on the dialog element itself.
      if (e.target === this.dialog) this.close();
    });
    this.refresh(store.get());
    store.subscribe((s) => this.refresh(s));
  }

  open(): void {
    if (!this.dialog.open) this.dialog.showModal();
  }

  close(): void {
    this.dialog.close();
  }

  toggleOpen(): void {
    if (this.dialog.open) this.close();
    else this.open();
  }

  private refresh(s: Settings): void {
    for (const fn of this.sync) fn(s);
  }

  private radios<K extends 'layout' | 'granularity' | 'context' | 'theme'>(
    legend: string,
    key: K,
    options: Option<Settings[K]>[],
    compact = false,
  ): HTMLElement {
    const name = `setting-${key}`;
    const inputs = options.map((opt) => {
      const input = h('input', { type: 'radio', name, value: String(opt.value) });
      input.addEventListener('change', () => {
        if (input.checked) this.store.set({ [key]: opt.value } as Partial<Settings>);
      });
      return { input, opt };
    });
    this.sync.push((s) => {
      for (const { input, opt } of inputs) input.checked = s[key] === opt.value;
    });
    return h(
      'fieldset',
      { class: `field ${compact ? 'field--chips' : 'field--cards'}` },
      h('legend', null, legend),
      h(
        'div',
        { class: 'choices' },
        ...inputs.map(({ input, opt }) =>
          h('label', { class: 'choice' }, input, h('span', { class: 'choice-label' }, opt.label), opt.hint ? h('span', { class: 'choice-hint' }, opt.hint) : null),
        ),
      ),
    );
  }

  private toggle(key: 'ignoreWhitespace' | 'ignoreCase' | 'ignoreBlankLines' | 'normalizeQuotes', label: string, hint: string): HTMLElement {
    const input = h('input', { type: 'checkbox', role: 'switch' });
    input.addEventListener('change', () => this.store.set({ [key]: input.checked }));
    this.sync.push((s) => {
      input.checked = s[key];
    });
    return h(
      'label',
      { class: 'switch' },
      input,
      h('span', { class: 'switch-track', 'aria-hidden': 'true' }),
      h('span', { class: 'switch-text' }, h('span', { class: 'choice-label' }, label), h('span', { class: 'choice-hint' }, hint)),
    );
  }
}

export const SHORTCUTS: Array<[string[], string]> = [
  [['n'], 'Next change'],
  [['p'], 'Previous change'],
  [['u'], 'Switch unified / side by side'],
  [['g'], 'Cycle paragraph → word → character'],
  [['s'], 'Swap Original and Revised'],
  [[','], 'Open settings'],
  [['?'], 'Show these shortcuts'],
  [['Esc'], 'Close a panel'],
];

export function helpDialog(): HTMLDialogElement {
  const dialog: HTMLDialogElement = h(
    'dialog',
    { class: 'help', id: 'help', 'aria-labelledby': 'help-title' },
    h(
      'div',
      { class: 'drawer-head' },
      h('h2', { id: 'help-title' }, 'Keyboard shortcuts'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close shortcuts', onclick: () => dialog.close() }, icon('close')),
    ),
    h(
      'dl',
      { class: 'keys' },
      ...SHORTCUTS.flatMap(([keys, what]) => [h('dt', null, ...keys.map((k) => h('kbd', null, k))), h('dd', null, what)]),
    ),
    h('p', { class: 'help-note' }, 'Shortcuts pause while you’re typing in a draft. Press Esc or Tab out to use them.'),
  );
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  return dialog;
}

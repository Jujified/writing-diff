import { findChanges, planItems, type Change } from '../diff/fold';
import type { DiffResult, Row, Segment } from '../diff/types';
import type { Layout, Settings } from '../settings';
import { h, plural } from './dom';

export type EmptyKind = 'both' | 'a' | 'b';

export interface NavState {
  current: number;
  total: number;
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Renders the aligned diff, folds unchanged stretches, keeps the change rail
 * in sync with the scroll position, and moves between changes.
 */
export class DiffView {
  private result: DiffResult | null = null;
  private settings: Settings | null = null;
  private layout: Layout = 'split';
  private changes: Change[] = [];
  private changeEls: HTMLElement[][] = [];
  private current = -1;
  private expanded = new Set<number>();
  private railTicks: HTMLElement[] = [];
  private railFrame = 0;

  constructor(
    private readonly scroller: HTMLElement,
    private readonly rail: HTMLElement,
    private readonly thumb: HTMLElement,
    private readonly onNav: (nav: NavState) => void,
  ) {
    scroller.addEventListener('scroll', () => this.updateThumb(), { passive: true });
    new ResizeObserver(() => this.scheduleRail()).observe(scroller);
    rail.addEventListener('click', (e) => {
      const tick = (e.target as HTMLElement).closest<HTMLElement>('.rail-tick');
      if (tick) return this.goTo(Number(tick.dataset.change));
      const box = rail.getBoundingClientRect();
      const ratio = (e.clientY - box.top) / box.height;
      scroller.scrollTo({ top: ratio * scroller.scrollHeight - scroller.clientHeight / 2, behavior: this.scrollBehavior() });
    });
  }

  get hasChanges(): boolean {
    return this.changes.length > 0;
  }

  setResult(result: DiffResult, settings: Settings, layout: Layout): void {
    if (result !== this.result) {
      this.expanded.clear();
      this.current = -1;
    }
    this.result = result;
    this.settings = settings;
    this.layout = layout;
    this.render();
  }

  showEmpty(kind: EmptyKind): void {
    this.result = null;
    this.changes = [];
    this.changeEls = [];
    this.current = -1;
    const copy: Record<EmptyKind, [string, string]> = {
      both: [
        'Put a draft on each side.',
        'Paste, type, or drop a file into Original and Revised. Changes appear here as you go — and nothing you add ever leaves this page.',
      ],
      a: ['Now add the original.', 'Paste or drop the earlier draft into Original to see what changed.'],
      b: ['Now add the revision.', 'Paste or drop the later draft into Revised to see what changed.'],
    };
    const [title, body] = copy[kind];
    this.scroller.replaceChildren(
      h(
        'div',
        { class: 'state state--empty' },
        h('p', { class: 'state-title' }, title),
        h('p', { class: 'state-body' }, body),
        kind === 'both' ? h('p', { class: 'state-formats' }, '.txt  ·  .md  ·  .rtf  ·  .docx  ·  .pdf') : null,
      ),
    );
    this.clearRail();
    this.emitNav();
  }

  showError(message: string): void {
    this.scroller.replaceChildren(
      h('div', { class: 'state state--error', role: 'alert' }, h('p', { class: 'state-title' }, 'The comparison stopped.'), h('p', { class: 'state-body' }, message)),
    );
    this.clearRail();
  }

  next(): void {
    if (this.changes.length) this.goTo(Math.min(this.current + 1, this.changes.length - 1));
  }

  prev(): void {
    if (this.changes.length) this.goTo(this.current < 0 ? 0 : Math.max(this.current - 1, 0));
  }

  goTo(index: number): void {
    if (index < 0 || index >= this.changes.length) return;
    for (const el of this.changeEls[this.current] ?? []) el.classList.remove('is-current');
    this.current = index;
    const els = this.changeEls[index] ?? [];
    for (const el of els) el.classList.add('is-current');
    this.railTicks.forEach((t, i) => t.classList.toggle('is-current', i === index));
    const first = els[0];
    if (first) {
      const top = first.offsetTop - Math.max(48, this.scroller.clientHeight * 0.3);
      this.scroller.scrollTo({ top, behavior: this.scrollBehavior() });
      first.focus({ preventScroll: true });
    }
    this.emitNav();
  }

  private scrollBehavior(): ScrollBehavior {
    return reducedMotion.matches ? 'auto' : 'smooth';
  }

  private emitNav(): void {
    this.onNav({ current: this.current, total: this.changes.length });
  }

  /* ---------------------------------------------------------------------- */

  private render(): void {
    const result = this.result;
    const settings = this.settings;
    if (!result || !settings) return;
    this.changes = findChanges(result.rows);
    this.changeEls = this.changes.map(() => []);
    if (this.current >= this.changes.length) this.current = -1;

    if (result.identical) {
      this.scroller.replaceChildren(this.identicalState(result, settings));
      this.clearRail();
      this.emitNav();
      return;
    }

    const changeOf = new Int32Array(result.rows.length).fill(-1);
    this.changes.forEach((c, ci) => {
      for (let i = c.start; i < c.end; i++) changeOf[i] = ci;
    });

    const table = h('div', {
      class: `diff diff--${this.layout}`,
      role: 'list',
      'aria-label': this.layout === 'split' ? 'Differences, side by side' : 'Differences',
    });
    if (this.layout === 'split') {
      table.append(
        h(
          'div',
          { class: 'diff-head', 'aria-hidden': 'true' },
          h('span', { class: 'diff-head-a' }, 'Original'),
          h('span', { class: 'diff-head-b' }, 'Revised'),
        ),
      );
    }
    for (const item of planItems(result.rows, settings.context, this.expanded)) {
      if (item.type === 'fold') {
        table.append(this.foldButton(item.start, item.end));
        continue;
      }
      const el = this.renderRow(result.rows[item.index]);
      const ci = changeOf[item.index];
      if (ci >= 0) {
        el.dataset.change = String(ci);
        if (this.changeEls[ci].length === 0) el.tabIndex = -1;
        if (ci === this.current) el.classList.add('is-current');
        this.changeEls[ci].push(el);
      }
      table.append(el);
    }
    this.scroller.replaceChildren(table);
    this.scheduleRail();
    this.emitNav();
  }

  private identicalState(result: DiffResult, s: Settings): HTMLElement {
    const ignored = [
      s.ignoreCase && 'capitalization',
      s.ignoreWhitespace && 'spacing',
      s.ignoreBlankLines && 'blank lines',
      s.normalizeQuotes && 'quote style',
    ].filter(Boolean) as string[];
    const list = ignored.length > 1 ? `${ignored.slice(0, -1).join(', ')} and ${ignored[ignored.length - 1]}` : ignored[0];
    const body = result.identicalAfterIgnoring
      ? `They match once differences in ${list} are set aside. Change that in Settings to see them.`
      : `Both drafts have the same ${plural(result.stats.paragraphsA, 'paragraph')}, word for word.`;
    return h('div', { class: 'state state--identical', role: 'status' }, h('p', { class: 'state-title' }, 'No differences.'), h('p', { class: 'state-body' }, body));
  }

  private foldButton(start: number, end: number): HTMLElement {
    const count = end - start;
    return h(
      'div',
      { class: 'fold', role: 'listitem' },
      h(
        'button',
        {
          type: 'button',
          class: 'fold-btn',
          'aria-expanded': 'false',
          onclick: () => {
            this.expanded.add(start);
            this.render();
          },
        },
        h('span', { class: 'fold-dots', 'aria-hidden': 'true' }, '⋯'),
        ` ${plural(count, 'unchanged paragraph')}`,
      ),
    );
  }

  private renderRow(row: Row): HTMLElement {
    const split = this.layout === 'split';
    const el = h('div', { class: `row row--${row.kind}`, role: 'listitem' });
    const num = (n: number | null, side: 'a' | 'b') =>
      h('span', { class: `ln ln-${side}`, 'aria-hidden': 'true' }, n === null ? '' : String(n));
    const mark = (m: string) =>
      h('span', { class: `mk${m === '−' ? ' mk--del' : m === '+' ? ' mk--ins' : ''}`, 'aria-hidden': 'true' }, m);
    const sr = (text: string) => h('span', { class: 'visually-hidden' }, text);

    switch (row.kind) {
      case 'equal':
        if (split) el.append(num(row.a, 'a'), mark(''), this.prose(row.textA), num(row.b, 'b'), mark(''), this.prose(row.textB));
        else el.append(num(row.a, 'a'), num(row.b, 'b'), mark(''), this.prose(row.textB));
        break;
      case 'del':
        if (split) el.append(num(row.a, 'a'), mark('−'), this.prose(row.text, 'del'), num(null, 'b'), mark(''), this.voidCell());
        else el.append(num(row.a, 'a'), num(null, 'b'), mark('−'), this.prose(row.text, 'del'));
        el.prepend(sr(`Removed paragraph ${row.a}: `));
        break;
      case 'ins':
        if (split) el.append(num(null, 'a'), mark(''), this.voidCell(), num(row.b, 'b'), mark('+'), this.prose(row.text, 'ins'));
        else el.append(num(null, 'a'), num(row.b, 'b'), mark('+'), this.prose(row.text, 'ins'));
        el.prepend(sr(`Added paragraph ${row.b}: `));
        break;
      case 'mod':
        if (split) {
          el.append(
            num(row.a, 'a'),
            mark('−'),
            this.segments(row.segments, 'a'),
            num(row.b, 'b'),
            mark('+'),
            this.segments(row.segments, 'b'),
          );
        } else {
          el.append(num(row.a, 'a'), num(row.b, 'b'), mark('±'), this.segments(row.segments, 'u'));
        }
        el.prepend(sr(`Changed paragraph ${row.b}: `));
        break;
      case 'gap-del':
      case 'gap-ins': {
        const del = row.kind === 'gap-del';
        const note = h('div', { class: 'txt txt--note' }, del ? 'Blank line removed' : 'Blank line added');
        if (split) {
          el.append(num(null, 'a'), mark(del ? '−' : ''), del ? note : this.voidCell(), num(null, 'b'), mark(del ? '' : '+'), del ? this.voidCell() : note);
        } else {
          el.append(num(null, 'a'), num(null, 'b'), mark(del ? '−' : '+'), note);
        }
        break;
      }
    }
    return el;
  }

  private prose(text: string, op?: 'del' | 'ins'): HTMLElement {
    const cell = h('div', { class: 'txt' });
    if (op) cell.append(this.mark(op, text));
    else cell.textContent = text;
    return cell;
  }

  private voidCell(): HTMLElement {
    return h('div', { class: 'txt txt--void', 'aria-hidden': 'true' });
  }

  private segments(segments: Segment[], side: 'a' | 'b' | 'u'): HTMLElement {
    const cell = h('div', { class: 'txt' });
    for (const seg of segments) {
      // In the unified column, spacing that only existed in the original
      // (e.g. around a deleted word) is kept so words don't run together.
      if (seg.op === 'eq') cell.append(side === 'a' ? seg.a : side === 'b' || seg.b || seg.a.trim() ? seg.b : seg.a);
      else if (seg.op === 'del' && side !== 'b') cell.append(this.mark('del', seg.a));
      else if (seg.op === 'ins' && side !== 'a') cell.append(this.mark('ins', seg.b));
    }
    return cell;
  }

  private mark(op: 'del' | 'ins', text: string): HTMLElement {
    const el = h(op, null);
    if (text.trim() === '') {
      // A change that is only spacing would otherwise be invisible.
      el.classList.add('ws');
      el.textContent = text.replace(/\t/g, '→').replace(/ /g, '·');
      el.title = op === 'del' ? 'Removed spacing' : 'Added spacing';
    } else {
      el.textContent = text;
    }
    return el;
  }

  /* ---------------------------------------------------------------------- */
  /* Change rail                                                             */
  /* ---------------------------------------------------------------------- */

  private clearRail(): void {
    this.railTicks = [];
    this.rail.querySelectorAll('.rail-tick').forEach((t) => t.remove());
    this.rail.classList.add('is-empty');
  }

  private scheduleRail(): void {
    cancelAnimationFrame(this.railFrame);
    this.railFrame = requestAnimationFrame(() => this.drawRail());
  }

  private drawRail(): void {
    this.clearRail();
    const total = this.scroller.scrollHeight;
    if (!this.changes.length || total === 0) return;
    this.rail.classList.remove('is-empty');
    this.railTicks = this.changes.map((change, i) => {
      const els = this.changeEls[i];
      const first = els[0];
      const last = els[els.length - 1];
      const top = first ? first.offsetTop : 0;
      const bottom = last ? last.offsetTop + last.offsetHeight : top;
      const kind = change.hasDel && change.hasIns ? 'mod' : change.hasDel ? 'del' : 'ins';
      const tick = h('span', { class: `rail-tick rail-tick--${kind}`, 'data-change': String(i), title: `Change ${i + 1}` });
      tick.style.top = `${(top / total) * 100}%`;
      tick.style.height = `max(3px, ${((bottom - top) / total) * 100}%)`;
      if (i === this.current) tick.classList.add('is-current');
      this.rail.append(tick);
      return tick;
    });
    this.updateThumb();
  }

  private updateThumb(): void {
    const { scrollTop, scrollHeight, clientHeight } = this.scroller;
    if (scrollHeight <= clientHeight) {
      this.thumb.hidden = true;
      return;
    }
    this.thumb.hidden = false;
    this.thumb.style.top = `${(scrollTop / scrollHeight) * 100}%`;
    this.thumb.style.height = `${(clientHeight / scrollHeight) * 100}%`;
  }
}

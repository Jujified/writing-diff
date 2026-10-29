import { countWords, normalizeText, splitParagraphs } from '../diff/normalize';
import { ACCEPT, ExtractError, extractFile, type FileKind, type Preview } from '../extract';
import { h, icon, plural } from './dom';

type Mode = 'text' | 'preview';

/** Everything a pane holds, so two panes can trade places. */
export interface PaneSnapshot {
  text: string;
  fileName: string | null;
  kind: FileKind | null;
  preview: Preview | null;
  mode: Mode;
  edited: boolean;
}

const EMPTY: PaneSnapshot = { text: '', fileName: null, kind: null, preview: null, mode: 'text', edited: false };

export class Pane {
  readonly el: HTMLElement;
  private state: PaneSnapshot = { ...EMPTY };
  private textarea: HTMLTextAreaElement;
  private previewEl: HTMLElement;
  private metaName: HTMLElement;
  private metaCounts: HTMLElement;
  private staleNote: HTMLElement;
  private errorEl: HTMLElement;
  private errorText: HTMLElement;
  private busyEl: HTMLElement;
  private fileInput: HTMLInputElement;
  private modeButtons: Record<Mode, HTMLButtonElement>;
  private clearButton: HTMLButtonElement;
  private loadToken = 0;
  private countsFrame = 0;

  constructor(
    readonly side: 'a' | 'b',
    readonly label: string,
    private readonly onChange: () => void,
  ) {
    const id = `pane-${side}`;
    this.textarea = h('textarea', {
      id: `${id}-text`,
      class: 'pane-text',
      spellcheck: 'false',
      autocomplete: 'off',
      'aria-label': `${label} draft text`,
      placeholder: side === 'a' ? 'Paste or type the earlier draft, or drop a file here.' : 'Paste or type the later draft, or drop a file here.',
    });
    this.previewEl = h('div', { class: 'pane-preview prose', tabindex: '0', role: 'document', 'aria-label': `${label} file preview`, hidden: true });
    this.metaName = h('span', { class: 'pane-name' });
    this.metaCounts = h('span', { class: 'pane-counts' });
    this.staleNote = h('p', { class: 'pane-note', hidden: true }, 'You’ve edited the text since loading. The preview shows the file; the comparison uses your edits.');
    this.errorText = h('span');
    this.errorEl = h(
      'div',
      { class: 'pane-error', role: 'alert', hidden: true },
      this.errorText,
      h('button', { type: 'button', class: 'icon-btn icon-btn--small', 'aria-label': 'Dismiss message', onclick: () => this.showError(null) }, icon('close')),
    );
    this.busyEl = h('div', { class: 'pane-busy', hidden: true, 'aria-live': 'polite' });
    this.fileInput = h('input', { type: 'file', accept: ACCEPT, class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });

    this.modeButtons = {
      text: h('button', { type: 'button', class: 'seg', 'aria-pressed': 'true', onclick: () => this.setMode('text') }, 'Text'),
      preview: h('button', { type: 'button', class: 'seg', 'aria-pressed': 'false', onclick: () => this.setMode('preview') }, 'Preview'),
    };
    this.clearButton = h(
      'button',
      { type: 'button', class: 'icon-btn', 'aria-label': `Clear ${label.toLowerCase()} draft`, title: 'Clear', onclick: () => this.clear() },
      icon('clear'),
    );

    this.el = h(
      'section',
      { class: `pane pane--${side}`, id, 'aria-labelledby': `${id}-title` },
      h(
        'header',
        { class: 'pane-head' },
        h('h2', { class: 'pane-title', id: `${id}-title` }, label),
        h('p', { class: 'pane-meta' }, this.metaName, this.metaCounts),
        h(
          'div',
          { class: 'pane-tools' },
          h('div', { class: 'segmented segmented--small', role: 'group', 'aria-label': `${label} view` }, this.modeButtons.text, this.modeButtons.preview),
          h(
            'button',
            { type: 'button', class: 'btn btn--quiet', onclick: () => this.fileInput.click() },
            icon('open'),
            h('span', null, 'Open file'),
          ),
          this.clearButton,
        ),
      ),
      this.errorEl,
      h('div', { class: 'pane-body' }, this.textarea, this.previewEl, this.busyEl, this.staleNote),
      h('div', { class: 'pane-drop', 'aria-hidden': 'true' }, h('span', null, `Drop to load as ${label}`)),
      this.fileInput,
    );

    this.textarea.addEventListener('input', () => {
      this.state.text = this.textarea.value;
      if (this.state.preview) this.state.edited = true;
      this.refreshMeta();
      this.onChange();
    });
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (file) void this.load(file);
    });
    this.bindDrop();
    this.refreshMeta();
  }

  get text(): string {
    return this.state.text;
  }

  get fileName(): string | null {
    return this.state.fileName;
  }

  focus(): void {
    (this.state.mode === 'text' ? this.textarea : this.previewEl).focus();
  }

  snapshot(): PaneSnapshot {
    return { ...this.state };
  }

  restore(snap: PaneSnapshot): void {
    this.state = { ...snap };
    this.textarea.value = snap.text;
    this.showError(null);
    this.applyMode();
    this.refreshMeta();
  }

  async load(file: File): Promise<void> {
    const token = ++this.loadToken;
    this.showError(null);
    this.busyEl.textContent = `Reading ${file.name}…`;
    this.busyEl.hidden = false;
    try {
      const result = await extractFile(file);
      if (token !== this.loadToken) return;
      if (this.state.preview?.type === 'pdf') this.state.preview.destroy();
      this.state = {
        text: result.text,
        fileName: file.name,
        kind: result.kind,
        preview: result.preview,
        // Plain text has nothing to preview beyond itself.
        mode: result.kind === 'txt' ? 'text' : 'preview',
        edited: false,
      };
      this.textarea.value = result.text;
      this.applyMode();
      this.refreshMeta();
      this.onChange();
    } catch (err) {
      if (token !== this.loadToken) return;
      this.showError(err instanceof ExtractError ? err.message : `“${file.name}” couldn’t be read.`);
      if (!(err instanceof ExtractError)) console.error(err);
    } finally {
      if (token === this.loadToken) this.busyEl.hidden = true;
    }
  }

  clear(): void {
    this.loadToken++;
    if (this.state.preview?.type === 'pdf') this.state.preview.destroy();
    this.state = { ...EMPTY };
    this.textarea.value = '';
    this.busyEl.hidden = true;
    this.showError(null);
    this.applyMode();
    this.refreshMeta();
    this.onChange();
  }

  setMode(mode: Mode): void {
    if (mode === 'preview' && !this.state.preview) return;
    this.state.mode = mode;
    this.applyMode();
  }

  private applyMode(): void {
    const { mode, preview } = this.state;
    const showPreview = mode === 'preview' && preview !== null;
    this.textarea.hidden = showPreview;
    this.previewEl.hidden = !showPreview;
    this.staleNote.hidden = !(showPreview && this.state.edited);
    this.modeButtons.text.setAttribute('aria-pressed', String(!showPreview));
    this.modeButtons.preview.setAttribute('aria-pressed', String(showPreview));
    this.modeButtons.preview.disabled = preview === null;
    this.modeButtons.preview.title = preview === null ? 'Load a file to see its formatted preview' : '';
    if (showPreview) this.renderPreview();
  }

  private renderedPreview: Preview | null = null;

  private renderPreview(): void {
    const preview = this.state.preview;
    if (!preview || this.renderedPreview === preview) return;
    this.renderedPreview = preview;
    this.previewEl.classList.toggle('pane-preview--pdf', preview.type === 'pdf');
    if (preview.type === 'html') {
      // Sanitized by DOMPurify in the extractor.
      this.previewEl.innerHTML = preview.html;
    } else {
      // Defer until the element has its laid-out width.
      requestAnimationFrame(() => preview.render(this.previewEl));
    }
  }

  private refreshMeta(): void {
    cancelAnimationFrame(this.countsFrame);
    this.countsFrame = requestAnimationFrame(() => {
      const { text, fileName } = this.state;
      const normalized = normalizeText(text, { normalizeQuotes: false });
      this.metaName.textContent = fileName ?? (text.trim() ? 'Pasted text' : 'Empty');
      this.metaName.title = fileName ?? '';
      this.metaCounts.textContent = text.trim()
        ? `${plural(countWords(normalized), 'word')} · ${plural(splitParagraphs(normalized).length, 'paragraph')}`
        : '';
      this.clearButton.disabled = !text && !fileName;
    });
  }

  private showError(message: string | null): void {
    this.errorEl.hidden = message === null;
    this.errorText.textContent = message ?? '';
  }

  private bindDrop(): void {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    this.el.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      this.el.classList.add('is-dropping');
    });
    this.el.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    this.el.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) this.el.classList.remove('is-dropping');
    });
    this.el.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      this.el.classList.remove('is-dropping');
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 1) this.showError('Drop one file at a time on each side.');
      else if (files[0]) void this.load(files[0]);
    });
  }
}

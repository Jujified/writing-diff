# Redline

A private, client-side diff for comparing two drafts of an essay. Paste,
type, or drop in an **Original** and a **Revised** draft (`.txt`, `.md`,
`.rtf`, `.docx`, or `.pdf`). Redline aligns them paragraph by paragraph, then
marks the words that changed: deletions in crimson with a strikethrough,
insertions in blue with an underline.

Everything runs in your browser. Nothing you load is uploaded, logged, or
saved.

## Privacy model

Privacy here is enforced by the browser, not just promised.

- **Content-Security-Policy.** `index.html` ships a strict CSP meta tag:

  ```
  default-src 'none'; script-src 'self'; worker-src 'self' blob:;
  style-src 'self'; font-src 'self'; img-src 'self' data: blob:;
  connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none';
  child-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'
  ```

  `connect-src 'none'` blocks `fetch`, XHR, WebSockets, EventSource, and
  `sendBeacon` outright, so even a compromised dependency can't send your text
  anywhere. Scripts, styles, and fonts may load only from the site itself;
  `blob:` workers are allowed only because pdf.js can spawn one. There are no
  inline scripts.
- **No third parties.** No analytics, telemetry, CDNs, or web fonts from
  elsewhere. Every dependency, including the three typefaces, is bundled.
- **Same-origin requests only.** The page loads its own files when it opens.
  The larger file readers (pdf.js, mammoth, marked) are split into chunks and
  fetched from this site the first time you open a file that needs them. Those
  requests carry no document content: files are read locally with
  `File.arrayBuffer()`, and pdf.js gets the bytes directly, with CMap,
  standard-font, and wasm fetching turned off.
- **Nothing persists.** Draft text lives only in memory. Text areas use
  `autocomplete="off"` so the browser doesn't restore them, and there is no
  service worker or cache API use. Only view settings (layout, granularity,
  ignore options, context, theme) are written to `localStorage` under
  `redline:settings:v1`.

To check for yourself: open DevTools → Network, load two files, and confirm
every request goes to the site's own origin and no request is made while you
type.

## Features

- **Two-stage diff.** Paragraphs are aligned first with jsdiff's `diffArrays`.
  Inside each changed region, removed and added paragraphs are paired by word
  overlap using a small order-preserving (Needleman–Wunsch) alignment. Each
  pair is then diffed by word or character. A paragraph with one changed word
  shows that word, not a whole-paragraph delete plus insert.
- **Web Worker.** Diffing runs off the main thread, debounced while you type,
  and stale results are discarded.
- **Normalization before diffing.** Line endings, Unicode NFC, no-break and
  other fixed-width spaces, zero-width characters, soft hyphens, and
  (optionally) curly vs. straight quotes. Every line break ends a paragraph;
  runs of blank lines collapse into one break.
- **Views.** Side by side (rows stay aligned and both columns scroll as one)
  or unified (git-style, one column, inline marks). Side by side switches to
  unified below 768px.
- **Settings.** Granularity (paragraph / word / character); ignore
  whitespace, capitalization, and blank-line changes; context size with
  collapsed "⋯ 12 unchanged paragraphs" folds that expand on click; and a
  light / dark / system theme. All settings persist.
- **Navigation.** Summary bar with words added and removed, paragraphs
  changed, and next/previous change. The change rail beside the diff marks
  every change in the document; click a mark to jump to it.
- **Accessible.** Marks use strikethrough and underline as well as colour, so
  they read in greyscale print and for colour-blind readers. All controls are
  keyboard-reachable with visible focus, icon buttons are labelled, and
  inline edits are announced to screen readers.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `n` / `p` | Next / previous change |
| `u` | Toggle unified / side by side |
| `g` | Cycle paragraph → word → character |
| `s` | Swap Original and Revised |
| `,` | Open settings |
| `?` | Show shortcuts |
| `Esc` | Close a panel, or leave a text area |

Shortcuts never fire while focus is in a text field or with a modifier key
held.

## File support

| Type | Diff text | Preview |
| --- | --- | --- |
| `.txt` | Read as UTF-8, falling back to Windows-1252 | Paragraphs |
| `.md` | The raw Markdown source | Rendered with `marked`, sanitized with DOMPurify |
| `.docx` | `mammoth.extractRawText` | `mammoth.convertToHtml`, sanitized |
| `.pdf` | `pdfjs-dist` text layer, rebuilt into paragraphs | Pages rendered to canvas, lazily |
| `.rtf` | Built-in reader (below) | Paragraphs with bold, italic, underline, strikethrough |

Each pane has a **Preview / Text** toggle. *Text* is the extracted plain text
the diff actually uses, and you can edit it.

**PDF paragraph rebuilding** (`src/extract/pdfText.ts`): text fragments are
grouped into lines by baseline. A new paragraph starts at a larger-than-usual
vertical gap, a first-line indent, a font-size change (headings), a list
bullet, or after a short line ending in closing punctuation. Words hyphenated
across a line break are rejoined when the next line starts lowercase. Page
numbers at the top or bottom of a page are dropped, and a paragraph that runs
across a page break stays whole. Limitations: a real hyphenated compound split
exactly at a line end ("self-/aware") is joined as "selfaware", and
multi-column layouts are read in content-stream order.

**Errors.** Unsupported types (including legacy `.doc`), empty or damaged
files, password-protected PDFs, and scanned PDFs with no text layer each get
a specific message saying what to do next.

### Why a built-in RTF reader

Each client-side option was bundled for the browser and measured:

| Library | Result |
| --- | --- |
| `rtf.js` 3.0.9 | Full renderer (tables, images, fonts). **2.1 MB minified, ~960 KB gzipped**, mostly codepage tables. |
| `@iarna/rtf-to-html` 1.1 / `rtf-parser` 1.3 | Built on Node streams and `iconv-lite`, so it won't bundle for the browser without Node polyfills. |
| `rtf-stream-parser` 4.0 | Only unwraps RTF-encapsulated HTML and text from Outlook email, not general documents. |

None was light enough for what an essay needs: paragraphs plus basic inline
formatting. `src/extract/rtf.ts` is a ~290-line tokenizer (about 3.5 KB
minified, loaded only when you open an `.rtf`). It handles `\par`, bold,
italic, underline, strikethrough, `\uN` with `\ucN` fallback skipping,
`\'hh` bytes decoded with the browser's built-in `TextDecoder` for the
document's `\ansicpg`, and common symbols. It skips font, colour, style,
picture, header/footer, and other non-text destinations. If you ever need
tables or embedded images, swap in `rtf.js` behind the same `extractFile`
interface.

## Local development

Requires Node 22.12 or newer.

```bash
npm ci
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

```bash
npm run preview
```

`npm run build` type-checks with `tsc` (strict) before building. The dev
server relaxes the CSP just enough for Vite's hot reload (a websocket and
inline styles). The production build ships the strict policy unchanged.

## Deploying to GitHub Pages

1. In the repository, open **Settings → Pages** and set **Source** to
   **GitHub Actions**.
2. Push to `main` (or run the workflow manually from the Actions tab).
   `.github/workflows/deploy.yml` installs dependencies, runs the tests,
   builds, and publishes `dist/` with `actions/upload-pages-artifact` and
   `actions/deploy-pages`.

**Base path.** Project sites are served from `/<repo>/`. The workflow sets
`VITE_BASE` from the repository name automatically. Locally, the default
comes from `REPO_NAME` at the top of `vite.config.ts`. For a custom domain or
a `<user>.github.io` repository, set a repository variable `VITE_BASE` to `/`
(Settings → Secrets and variables → Actions → Variables), or build with
`VITE_BASE=/ npm run build`.

## Project layout

```
index.html                 CSP, static shell
public/theme-init.js       applies the saved theme before first paint
src/main.ts                wiring: panes, worker, settings, shortcuts
src/settings.ts            view settings + localStorage
src/diff/normalize.ts      text normalization and paragraph splitting
src/diff/engine.ts         two-stage diff (pure, unit-tested)
src/diff/fold.ts           change grouping and context folding
src/diff/worker.ts         Web Worker entry; client.ts debounces requests
src/extract/               txt / md / docx / pdf / rtf readers (lazy-loaded)
src/ui/                    panes, diff view and change rail, settings drawer
tests/                     Vitest: normalization, alignment, ignore options,
                           PDF rejoining, RTF, folding
```

import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
// Vite emits the worker as a same-origin file, which the CSP allows.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ExtractError, type Preview } from './errors';
import { pdfItemsToText, type PdfTextItem } from './pdfText';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Fewer visible characters per page than this means there's no real text layer. */
const MIN_CHARS_PER_PAGE = 20;

export async function extractPdf(buffer: ArrayBuffer): Promise<{ text: string; preview: Preview }> {
  const task = getDocument({
    data: new Uint8Array(buffer),
    // Everything below keeps pdf.js from fetching anything: no CMaps,
    // standard fonts, or wasm decoders over the network.
    useWorkerFetch: false,
    useWasm: false,
    useSystemFonts: true,
    enableXfa: false,
  });
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (err) {
    if (err instanceof Error && err.name === 'PasswordException') {
      throw new ExtractError('This PDF is password-protected. Remove the password in your PDF app, then load it again.');
    }
    throw err;
  }

  const pages: PdfTextItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .filter((item): item is TextItem => 'str' in item)
        .map((item) => ({
          str: item.str,
          x: item.transform[4] as number,
          y: item.transform[5] as number,
          width: item.width,
          height: item.height || Math.hypot(item.transform[2] as number, item.transform[3] as number),
          hasEOL: item.hasEOL,
        })),
    );
    page.cleanup();
  }

  const text = pdfItemsToText(pages);
  const visible = text.replace(/\s/g, '').length;
  if (visible < Math.max(1, doc.numPages) * MIN_CHARS_PER_PAGE) {
    void task.destroy();
    throw new ExtractError(
      visible === 0
        ? 'This PDF has no text layer — it looks like a scanned image. Run it through OCR first (most scanner apps and PDF editors can), or paste the text instead.'
        : 'This PDF has almost no selectable text, so it’s probably a scan. Run it through OCR first, or paste the text instead.',
    );
  }
  return { text, preview: pdfPreview(task, doc) };
}

function pdfPreview(task: PDFDocumentLoadingTask, doc: PDFDocumentProxy): Preview {
  let observer: IntersectionObserver | null = null;
  return {
    type: 'pdf',
    pageCount: doc.numPages,
    render(container) {
      observer?.disconnect();
      container.replaceChildren();
      const width = Math.max(240, container.clientWidth - 32);
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer?.unobserve(entry.target);
            void drawPage(doc, entry.target as HTMLCanvasElement, width);
          }
        },
        { root: container, rootMargin: '400px 0px' },
      );
      for (let p = 1; p <= doc.numPages; p++) {
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page';
        canvas.dataset.page = String(p);
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Page ${p} of ${doc.numPages}`);
        // Reserve roughly a US Letter page so scrolling is stable before render.
        canvas.style.width = `${width}px`;
        canvas.style.height = `${Math.round(width * 1.294)}px`;
        container.append(canvas);
        observer.observe(canvas);
      }
    },
    destroy() {
      observer?.disconnect();
      void task.destroy();
    },
  };
}

async function drawPage(doc: PDFDocumentProxy, canvas: HTMLCanvasElement, cssWidth: number): Promise<void> {
  const page = await doc.getPage(Number(canvas.dataset.page));
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: scale * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
  try {
    await page.render({ canvas, viewport }).promise;
  } catch {
    // A page that fails to draw stays blank; the text is still available.
  }
}

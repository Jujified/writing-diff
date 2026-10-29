import type { DiffOptions, DiffRequest, DiffResponse, DiffResult } from './types';

type Listener = (result: DiffResult | null, error?: string) => void;

/**
 * Runs diffs off the main thread. Requests are debounced, and only the newest
 * request's answer is delivered, so typing never queues up stale work.
 */
export class DiffClient {
  private worker: Worker;
  private nextId = 1;
  private latestId = 0;
  private timer: number | undefined;

  constructor(
    private readonly onResult: Listener,
    private readonly onBusy: (busy: boolean) => void,
  ) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'diff' });
    this.worker.onmessage = (event: MessageEvent<DiffResponse>) => {
      const res = event.data;
      if (res.id !== this.latestId) return;
      this.onBusy(false);
      if (res.ok) this.onResult(res.result);
      else this.onResult(null, res.error);
    };
    this.worker.onerror = (event) => {
      this.onBusy(false);
      this.onResult(null, event.message || 'The diff worker stopped unexpectedly.');
    };
  }

  request(a: string, b: string, options: DiffOptions, delayMs = 250): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.send(a, b, options), delayMs);
  }

  /** Drop any pending or in-flight request, e.g. when a side is cleared. */
  cancel(): void {
    window.clearTimeout(this.timer);
    this.latestId = this.nextId++;
    this.onBusy(false);
  }

  private send(a: string, b: string, options: DiffOptions): void {
    const id = this.nextId++;
    this.latestId = id;
    this.onBusy(true);
    const req: DiffRequest = { id, a, b, options };
    this.worker.postMessage(req);
  }
}

import { computeDiff } from './engine';
import type { DiffRequest, DiffResponse } from './types';

self.onmessage = (event: MessageEvent<DiffRequest>) => {
  const { id, a, b, options } = event.data;
  const started = performance.now();
  let response: DiffResponse;
  try {
    const result = computeDiff(a, b, options);
    response = { id, ok: true, result, ms: performance.now() - started };
  } catch (err) {
    response = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(response);
};

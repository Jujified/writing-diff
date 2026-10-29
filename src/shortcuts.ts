export type ShortcutHandlers = Record<string, () => void>;

/** True when keystrokes belong to a text field rather than to the app. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type);
  }
  return false;
}

/**
 * Single-key shortcuts. They never fire while focus is in a text field, with a
 * modifier held (so browser and OS shortcuts keep working), or while a modal
 * dialog is open — except `?`, which toggles the shortcut list itself.
 */
export function bindShortcuts(handlers: ShortcutHandlers): void {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    if (e.key === 'Escape' && e.target instanceof HTMLTextAreaElement) {
      // Leave the draft so shortcuts work again.
      e.target.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    const dialogOpen = document.querySelector('dialog[open]') !== null;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (dialogOpen && e.key !== '?') return;
    const handler = handlers[e.key === '?' ? '?' : key];
    if (!handler) return;
    e.preventDefault();
    handler();
  });
}

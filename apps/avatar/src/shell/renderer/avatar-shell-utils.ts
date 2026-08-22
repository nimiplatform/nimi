export function normalizeText(value: string | null | undefined): string {
  return String(value || '').trim();
}

export function shortenId(value: string | null | undefined): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return 'Unavailable';
  }
  return normalized.length > 16
    ? `${normalized.slice(0, 8)}…${normalized.slice(-4)}`
    : normalized;
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAbortError(): Error {
  const error = new Error('Foreground voice request aborted.');
  error.name = 'AbortError';
  return error;
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  // `summary` is the clickable disclosure of <details> diagnostics blocks;
  // without it, expanding diagnostics on a failure surface arms avatar drag.
  return target instanceof Element && Boolean(target.closest('button, input, textarea, select, a, form, summary'));
}

const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

function menuItemIsDisabled(item: HTMLElement): boolean {
  return (
    (item instanceof HTMLButtonElement && item.disabled)
    || item.getAttribute('aria-disabled') === 'true'
  );
}

// Arrow-key / Home / End navigation for role="menu" containers: moves focus
// between enabled items (wraps around). Returns true when the key was handled
// so the caller can preventDefault.
export function moveMenuItemFocus(menu: HTMLElement, key: string): boolean {
  const items = Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR))
    .filter((item) => !menuItemIsDisabled(item));
  if (items.length === 0) return false;
  const active = document.activeElement;
  const currentIndex = active instanceof HTMLElement ? items.indexOf(active) : -1;
  let nextIndex: number;
  if (key === 'ArrowDown') {
    nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
  } else if (key === 'ArrowUp') {
    nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
  } else if (key === 'Home') {
    nextIndex = 0;
  } else if (key === 'End') {
    nextIndex = items.length - 1;
  } else {
    return false;
  }
  items[nextIndex]?.focus();
  return true;
}

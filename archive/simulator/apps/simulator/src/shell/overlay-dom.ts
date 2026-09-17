/** DOM-only helpers for the Simulator overlay coordinator. */

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface ElementInertSnapshot {
  readonly target: HTMLElement;
  readonly inert: boolean;
  readonly ariaHidden: string | null;
}

export interface RootScrollSnapshot {
  readonly overflow: string;
  readonly marker: string | null;
}

export function isConnectedInside(
  node: HTMLElement | null,
  roots: readonly HTMLElement[],
): boolean {
  return node !== null
    && node.isConnected
    && roots.some((root) => root === node || root.contains(node));
}

export function setElementInert(target: HTMLElement): ElementInertSnapshot {
  const snapshot = {
    target,
    inert: target.inert === true,
    ariaHidden: target.getAttribute('aria-hidden'),
  };
  target.inert = true;
  target.setAttribute('aria-hidden', 'true');
  return snapshot;
}

export function restoreElementInert(snapshot: ElementInertSnapshot): void {
  snapshot.target.inert = snapshot.inert;
  if (snapshot.ariaHidden === null) {
    snapshot.target.removeAttribute('aria-hidden');
  } else {
    snapshot.target.setAttribute('aria-hidden', snapshot.ariaHidden);
  }
}

export function captureRootScroll(root: HTMLElement): RootScrollSnapshot {
  return {
    overflow: root.style.overflow,
    marker: root.getAttribute('data-nimi-scroll-locked'),
  };
}

export function lockRootScroll(root: HTMLElement): void {
  root.style.overflow = 'hidden';
  root.setAttribute('data-nimi-scroll-locked', 'true');
}

export function restoreRootScroll(
  root: HTMLElement,
  snapshot: RootScrollSnapshot,
): void {
  root.style.overflow = snapshot.overflow;
  if (snapshot.marker === null) {
    root.removeAttribute('data-nimi-scroll-locked');
  } else {
    root.setAttribute('data-nimi-scroll-locked', snapshot.marker);
  }
}

export function firstFocusable(content: HTMLElement): HTMLElement | null {
  return content.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
}

export function focusElement(target: HTMLElement | null): boolean {
  if (!target?.isConnected) return false;
  try {
    target.focus({ preventScroll: true });
    return target.ownerDocument.activeElement === target;
  } catch {
    return false;
  }
}

export function eventTargetElement(event: unknown): HTMLElement | null {
  if (!event || typeof event !== 'object') return null;
  const target = (event as { readonly target?: object | null }).target;
  return target && typeof target === 'object' && (target as { nodeType?: number }).nodeType === 1
    ? target as HTMLElement
    : null;
}

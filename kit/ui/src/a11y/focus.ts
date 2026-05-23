/**
 * Focusable element discovery + focus management primitives (wave-b
 * fork F1 lift-the-bar).
 *
 * Provides a single canonical selector + helper for focus-trap and
 * keyboard navigation code paths so features no longer hand-roll
 * the focusable-selector regex per component.
 */

/**
 * CSS selector for elements that are programmatically focusable in
 * common interactive flows. Adapted from a11y-focus-trap conventions
 * with kit-specific tightening (excludes negative tabindex, hidden,
 * and inert subtrees).
 */
export const FOCUSABLE_ELEMENTS_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'area[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]:not([tabindex="-1"])',
  'audio[controls]:not([tabindex="-1"])',
  'video[controls]:not([tabindex="-1"])',
].join(',');

/**
 * Collect the focusable descendants of an element in DOM order,
 * skipping `aria-hidden="true"` subtrees and elements within `[inert]`
 * containers.
 */
export function collectFocusableElements(root: HTMLElement): HTMLElement[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENTS_SELECTOR));
  return candidates.filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    // climb to detect inert / aria-hidden ancestors up to the root
    for (let cursor: HTMLElement | null = el; cursor && cursor !== root; cursor = cursor.parentElement) {
      if (cursor.hasAttribute('inert')) return false;
      if (cursor.getAttribute('aria-hidden') === 'true') return false;
    }
    // visibility check: width/height/zero-display is treated as unfocusable
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return true;
  });
}

/**
 * Standard kit focus-ring class composition. Components should
 * reference this rather than re-author `focus-visible:` rules so
 * the focus-ring shape (color, offset, width) stays consistent
 * across the kit surface.
 *
 * Pairs with the design-token CSS variables `--nimi-focus-ring` /
 * `--nimi-focus-ring-offset` defined in the generated theme bundle.
 */
export const FOCUS_RING_CLASS_NAME =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring,#3b82f6)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nimi-focus-ring-offset,transparent)]';

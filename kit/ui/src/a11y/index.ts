/**
 * `@nimiplatform/kit/ui/a11y`
 *
 * Accessibility primitives + helpers (wave-b fork F1 lift-the-bar).
 *
 * Kit components and consumer apps depend on this module for
 * focus management (selector, focusable enumeration, focus-ring
 * class composition) and visually-hidden text utilities.
 */

export {
  FOCUSABLE_ELEMENTS_SELECTOR,
  FOCUS_RING_CLASS_NAME,
  collectFocusableElements,
} from './focus.js';
export {
  VISUALLY_HIDDEN_CLASS_NAME,
  VISUALLY_HIDDEN_STYLE,
} from './visually-hidden.js';

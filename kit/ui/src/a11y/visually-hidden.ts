/**
 * Visually-hidden style for screen-reader-only labels.
 *
 * Standard sr-only class composition (matches Tailwind's
 * `sr-only` shape). Provided as a plain string + className so kit
 * components can attach screen-reader labels without depending on
 * Tailwind being in scope.
 */
export const VISUALLY_HIDDEN_CLASS_NAME = 'sr-only';

export const VISUALLY_HIDDEN_STYLE = Object.freeze({
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: '0',
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  borderWidth: '0',
}) as Readonly<Record<string, string>>;

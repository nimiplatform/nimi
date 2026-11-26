import type { DragEvent } from 'react';

const DECORATIVE_MEDIA_SELECTOR = 'img, svg, picture, canvas, [draggable="false"]';

/**
 * Prevent ghost-image dragging on decorative media while preserving normal
 * native text selection and drag behavior across page copy.
 */
export function preventDecorativeDragStart(event: DragEvent<HTMLElement>): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest(DECORATIVE_MEDIA_SELECTOR)) {
    event.preventDefault();
  }
}

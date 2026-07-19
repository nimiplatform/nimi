import type { Rect } from './weave';

/** The aurora snap-guide line shown while dragging near a weave candidate. */
export function SnapGuide({ rect }: { rect: Rect | null }) {
  if (!rect) return null;
  return (
    <div
      className="snap-guide"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      aria-hidden
    />
  );
}

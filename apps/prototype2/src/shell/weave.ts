/* Pane weaving (Aurora idiom): panes dragged together link into a group
 * that moves as one; members can be unlinked. Pure helpers, no DOM. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type EdgeDir = 'left' | 'right' | 'top' | 'bottom';

/** Which of a's edges sits within `t` px of b — and in which direction. */
export function edgeDir(a: Rect, b: Rect, t = 48): EdgeDir | null {
  const vOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const hOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const rightLeft = Math.abs(a.x + a.w - b.x);
  const leftRight = Math.abs(b.x + b.w - a.x);
  const bottomTop = Math.abs(a.y + a.h - b.y);
  const topBottom = Math.abs(b.y + b.h - a.y);
  const minH = Math.min(rightLeft, leftRight);
  const minV = Math.min(bottomTop, topBottom);
  if (minH < t && minH <= minV && vOverlap > 64) {
    return rightLeft <= leftRight ? 'right' : 'left';
  }
  if (minV < t && hOverlap > 64) {
    return bottomTop <= topBottom ? 'bottom' : 'top';
  }
  return null;
}

/** Edge-proximity test: a's edge within `t` px of b's edge with real overlap. */
export function nearEdge(a: Rect, b: Rect, t = 48): boolean {
  return edgeDir(a, b, t) !== null;
}

export function groupOf(groups: string[][], id: string): string[] | undefined {
  return groups.find((g) => g.includes(id));
}

/** The visual snap-guide line for a candidate weave, drawn along the target
 * edge the dragged pane would snap flush against. */
export function guideFor(dir: EdgeDir, o: Rect): Rect {
  if (dir === 'left') return { x: o.x + o.w + 5, y: o.y + 8, w: 2, h: o.h - 16 };
  if (dir === 'right') return { x: o.x - 7, y: o.y + 8, w: 2, h: o.h - 16 };
  if (dir === 'bottom') return { x: o.x + 8, y: o.y - 7, w: o.w - 16, h: 2 };
  return { x: o.x + 8, y: o.y + o.h + 5, w: o.w - 16, h: 2 };
}

export function linkGroups(groups: string[][], a: string, b: string): string[][] {
  if (a === b) return groups;
  const ga = groupOf(groups, a);
  const gb = groupOf(groups, b);
  if (ga && gb) {
    if (ga === gb) return groups;
    return groups.filter((g) => g !== ga && g !== gb).concat([[...ga, ...gb]]);
  }
  if (ga) return groups.map((g) => (g === ga ? [...g, b] : g));
  if (gb) return groups.map((g) => (g === gb ? [...g, a] : g));
  return [...groups, [a, b]];
}

export function unlinkGroup(groups: string[][], id: string): string[][] {
  return groups
    .map((g) => g.filter((member) => member !== id))
    .filter((g) => g.length > 1);
}

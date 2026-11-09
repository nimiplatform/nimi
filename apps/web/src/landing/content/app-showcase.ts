export function wrapShowcaseIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

export function findCenteredShowcaseIndex(
  logos: ReadonlyArray<Pick<DOMRect, 'left' | 'right'>>,
  bounds: Pick<DOMRect, 'left' | 'right'>,
  count: number,
): number | null {
  const center = (bounds.left + bounds.right) / 2;
  let centeredIndex: number | null = null;
  let centeredDistance = Number.POSITIVE_INFINITY;
  logos.forEach((logo, index) => {
    if (logo.right < bounds.left || logo.left > bounds.right) return;
    const distance = Math.abs((logo.left + logo.right) / 2 - center);
    if (distance < centeredDistance) {
      centeredDistance = distance;
      centeredIndex = wrapShowcaseIndex(index, count);
    }
  });
  return centeredIndex;
}

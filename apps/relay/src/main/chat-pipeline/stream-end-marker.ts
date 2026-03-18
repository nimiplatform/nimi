export const DEFAULT_STREAM_END_MARKER = '|END|';

const MIN_PARTIAL_MARKER_SIZE = 2;

export function findTrailingEndMarkerFragmentLength(
  value: string,
  marker = DEFAULT_STREAM_END_MARKER,
): number {
  const trimmedEnd = String(value || '').replace(/\s+$/u, '');
  if (!trimmedEnd) {
    return 0;
  }
  if (trimmedEnd.endsWith(marker)) {
    return marker.length;
  }
  for (let size = marker.length - 1; size >= MIN_PARTIAL_MARKER_SIZE; size -= 1) {
    if (trimmedEnd.endsWith(marker.slice(0, size))) {
      return size;
    }
  }
  return 0;
}

export function stripTrailingEndMarkerFragment(
  value: string,
  marker = DEFAULT_STREAM_END_MARKER,
): string {
  const trimmedEnd = String(value || '').replace(/\s+$/u, '');
  const fragmentLength = findTrailingEndMarkerFragmentLength(trimmedEnd, marker);
  if (fragmentLength <= 0) {
    return trimmedEnd;
  }
  return trimmedEnd.slice(0, -fragmentLength).replace(/\s+$/u, '');
}

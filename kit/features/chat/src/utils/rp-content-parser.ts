export type RpSegmentKind = 'narration' | 'dialogue';

export type RpSegment = {
  kind: RpSegmentKind;
  text: string;
};

const RP_NARRATION_RE = /（[^）]+）/u;

export function hasRpContent(text: string): boolean {
  return RP_NARRATION_RE.test(text);
}

export function parseRpSegments(text: string): RpSegment[] {
  if (!text) return [];

  const segments: RpSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const openIndex = text.indexOf('（', cursor);

    if (openIndex === -1) {
      const remaining = text.slice(cursor);
      if (remaining.trim()) {
        segments.push({ kind: 'dialogue', text: remaining });
      }
      break;
    }

    const closeIndex = text.indexOf('）', openIndex + 1);

    if (closeIndex === -1) {
      const remaining = text.slice(cursor);
      if (remaining.trim()) {
        segments.push({ kind: 'dialogue', text: remaining });
      }
      break;
    }

    if (openIndex > cursor) {
      const before = text.slice(cursor, openIndex);
      if (before.trim()) {
        segments.push({ kind: 'dialogue', text: before });
      }
    }

    const narrationContent = text.slice(openIndex + 1, closeIndex);
    segments.push({ kind: 'narration', text: narrationContent });

    cursor = closeIndex + 1;
  }

  return segments;
}

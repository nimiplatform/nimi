const SEGMENT_SPLIT_RE = /[-:]/;

function toCamelCase(segment: string): string {
  if (!segment) return '';
  return segment[0]!.toUpperCase() + segment.slice(1).toLowerCase();
}

export function activityIdToMotionGroup(activityId: string): string {
  const segments = activityId.split(SEGMENT_SPLIT_RE).filter((segment) => segment.length > 0);
  return `Activity_${segments.map(toCamelCase).join('')}`;
}

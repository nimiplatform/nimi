import { getClassification } from '@renderer/data/classification.js';

type ClassificationBadgeProps = {
  contentType: string;
  truthMode: string;
  size?: 'sm' | 'md';
};

const BADGE_COLORS: Record<string, string> = {
  history:    'bg-blue-100 text-blue-700 border-blue-200',
  literature: 'bg-purple-100 text-purple-700 border-purple-200',
  mythology:  'bg-amber-100 text-amber-700 border-amber-200',
};

export function ClassificationBadge({ contentType, truthMode, size = 'sm' }: ClassificationBadgeProps) {
  const classification = getClassification(contentType, truthMode);
  if (!classification) return null;

  const colorCls = BADGE_COLORS[contentType] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200';
  const sizeCls = size === 'md' ? 'text-sm px-3 py-1' : 'text-xs px-2 py-0.5';

  return (
    <span className={`inline-flex items-center rounded-full border font-medium ${sizeCls} ${colorCls}`}>
      {classification.badge}
    </span>
  );
}

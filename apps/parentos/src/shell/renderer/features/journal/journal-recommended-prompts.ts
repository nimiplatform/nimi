import type { ObservationDimension } from '../../knowledge-base/gen/observation-framework.gen.js';

export interface RecommendedPrompt {
  dimensionId: string;
  displayName: string;
  parentQuestion: string;
  entryCountLast14d: number;
}

export type GapAnalysisEntry = Pick<
  { dimensionId: string | null; recordedAt: string },
  'dimensionId' | 'recordedAt'
>;

/**
 * Compute recommended observation prompts based on dimension gap analysis.
 *
 * Returns the least-recorded active dimensions so the parent is nudged toward
 * areas they haven't been observing recently.
 */
export function computeRecommendedPrompts(
  activeDimensions: readonly ObservationDimension[],
  recentEntries: readonly GapAnalysisEntry[],
  options?: { maxPrompts?: number; windowDays?: number },
): RecommendedPrompt[] {
  if (activeDimensions.length === 0) return [];

  const windowDays = options?.windowDays ?? 14;
  const maxPrompts = options?.maxPrompts ?? 3;

  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const counts = new Map<string, number>();
  for (const entry of recentEntries) {
    if (!entry.dimensionId || entry.recordedAt < cutoff) continue;
    counts.set(entry.dimensionId, (counts.get(entry.dimensionId) ?? 0) + 1);
  }

  const scored = activeDimensions.map((dim) => ({
    dimensionId: dim.dimensionId,
    displayName: dim.displayName,
    parentQuestion: dim.parentQuestion,
    entryCountLast14d: counts.get(dim.dimensionId) ?? 0,
  }));

  scored.sort((a, b) => a.entryCountLast14d - b.entryCountLast14d);

  return scored.slice(0, maxPrompts);
}

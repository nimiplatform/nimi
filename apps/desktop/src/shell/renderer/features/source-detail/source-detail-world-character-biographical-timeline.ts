import type { SourceDetailWorldCharacterMilestone } from './source-detail-model.js';
import { compareWorldCharacterMilestones } from './source-detail-world-character-milestones.js';

export type SourceDetailBiographicalPrimaryNode = {
  kind: 'primary';
  milestone: SourceDetailWorldCharacterMilestone;
};

export type SourceDetailBiographicalClueList = {
  kind: 'clueList';
  variant: 'all' | 'undated';
  clues: SourceDetailWorldCharacterMilestone[];
};

export type SourceDetailBiographicalTimelineSection =
  | SourceDetailBiographicalPrimaryNode
  | SourceDetailBiographicalClueList;

// A milestone is placed on the timeline only when it carries an explicit time
// label; its title and summary are never parsed for dates.
function hasExplicitTime(milestone: SourceDetailWorldCharacterMilestone): boolean {
  return Boolean(milestone.timeLabel?.trim());
}

// Dated milestones become timeline nodes in time order. Undated milestones are
// listed together as authored; they are not attached to a dated node by text
// overlap or kind, and each keeps its explicit kind.
export function buildSourceDetailBiographicalTimeline(
  milestones: readonly SourceDetailWorldCharacterMilestone[],
): SourceDetailBiographicalTimelineSection[] {
  const dated = milestones.filter(hasExplicitTime).sort(compareWorldCharacterMilestones);
  const undated = milestones.filter((milestone) => !hasExplicitTime(milestone)).sort(compareWorldCharacterMilestones);
  if (dated.length === 0) {
    return undated.length > 0
      ? [{ kind: 'clueList', variant: 'all', clues: undated }]
      : [];
  }
  const sections: SourceDetailBiographicalTimelineSection[] = dated.map((milestone) => ({
    kind: 'primary',
    milestone,
  }));
  if (undated.length > 0) {
    sections.push({ kind: 'clueList', variant: 'undated', clues: undated });
  }
  return sections;
}

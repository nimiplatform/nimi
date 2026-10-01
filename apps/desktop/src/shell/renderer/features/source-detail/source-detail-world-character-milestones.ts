import type { JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { SourceDetailWorldCharacterMilestone } from './source-detail-model.js';
import {
  readOptionalString,
  readScalarString,
  readTimeLabelSortYear,
} from './source-detail-model-readers.js';
import {
  mergeDistinctText,
  mergeTimeLabel,
  normalizedMergeText,
} from './source-detail-world-character-common.js';
import {
  isCareerRelationshipType,
  relationshipAttributes,
  readRelationshipId,
  readRelationshipLabel,
  readRelationshipSummary,
  readRelationshipTargetEntityId,
  readRelationshipTimeLabel,
  readRelationshipType,
} from './source-detail-world-character-relationships.js';

type CareerMilestoneCandidate = SourceDetailWorldCharacterMilestone & {
  mergeKey: string;
};

const KIND_ORDER: Record<SourceDetailWorldCharacterMilestone['kind'], number> = {
  biography: 0,
  entry: 1,
  office: 2,
  work: 3,
  relationship: 4,
};

// The career kind is the relationship row's explicit type; it is never
// re-derived from the row's title or summary.
function careerMilestoneKind(type: string): SourceDetailWorldCharacterMilestone['kind'] {
  return type === 'postedToOffice' ? 'office' : 'entry';
}

// Rows share a merge key only through explicit identity: the same target
// entity, the same office id, or the same explicit label.
function readCareerMilestoneMergeKey(row: JsonObject, type: string, title: string): string {
  const targetEntityId = readRelationshipTargetEntityId(row);
  if (targetEntityId) {
    return `${type}:target:${targetEntityId}`;
  }
  const attributes = relationshipAttributes(row);
  if (type === 'postedToOffice') {
    const officeId = readScalarString(attributes.officeId)
      ?? readScalarString(attributes.officeCode);
    if (officeId) {
      return `${type}:office:${officeId}`;
    }
    const officeLabel = normalizedMergeText(readOptionalString(attributes, 'officeLabel'));
    if (officeLabel) {
      return `${type}:office-label:${officeLabel}`;
    }
  }
  return `${type}:title:${normalizedMergeText(title)}`;
}

function mergeMilestone<T extends SourceDetailWorldCharacterMilestone>(left: T, right: SourceDetailWorldCharacterMilestone): T {
  return {
    ...left,
    summary: mergeDistinctText(left.summary, right.summary),
    sequence: left.sequence ?? right.sequence,
    timeLabel: mergeTimeLabel(left.timeLabel, right.timeLabel),
    derived: left.derived || right.derived,
  };
}

export function readCareerMilestonesFromRelationships(relationships: JsonObject[]): SourceDetailWorldCharacterMilestone[] {
  const result: CareerMilestoneCandidate[] = [];
  relationships.forEach((row, index) => {
    const type = readRelationshipType(row);
    if (!isCareerRelationshipType(type)) {
      return;
    }
    const summary = readRelationshipSummary(row);
    const title = readRelationshipLabel(row) ?? summary;
    if (!title) {
      return;
    }
    const candidate: CareerMilestoneCandidate = {
      id: `career-${readRelationshipId(row, `${type}-${index + 1}`)}`,
      mergeKey: readCareerMilestoneMergeKey(row, type, title),
      title,
      summary,
      sequence: null,
      timeLabel: readRelationshipTimeLabel(row),
      kind: careerMilestoneKind(type),
      derived: true,
    };
    const existingIndex = result.findIndex((existing) => existing.mergeKey === candidate.mergeKey);
    const existing = existingIndex >= 0 ? result[existingIndex] : undefined;
    if (existing) {
      result[existingIndex] = mergeMilestone(existing, candidate);
      return;
    }
    result.push(candidate);
  });
  return result.map(({ mergeKey: _mergeKey, ...milestone }) => milestone);
}

// Only records that are literally the same entry collapse: identical explicit
// kind plus an identical title, or an identical non-empty summary. Records with
// different kinds or different text stay separate; nothing is reclassified.
function isSameExplicitMilestone(
  left: SourceDetailWorldCharacterMilestone,
  right: SourceDetailWorldCharacterMilestone,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.title.trim() === right.title.trim()) {
    return true;
  }
  const leftSummary = left.summary?.trim() ?? '';
  return leftSummary.length > 0 && leftSummary === (right.summary?.trim() ?? '');
}

function dedupeMilestones(
  milestones: readonly SourceDetailWorldCharacterMilestone[],
): SourceDetailWorldCharacterMilestone[] {
  const result: SourceDetailWorldCharacterMilestone[] = [];
  for (const milestone of milestones) {
    const existingIndex = result.findIndex((candidate) => isSameExplicitMilestone(candidate, milestone));
    const existing = existingIndex >= 0 ? result[existingIndex] : undefined;
    if (existing) {
      result[existingIndex] = mergeMilestone(existing, milestone);
      continue;
    }
    result.push(milestone);
  }
  return result;
}

export function compareWorldCharacterMilestones(
  left: SourceDetailWorldCharacterMilestone,
  right: SourceDetailWorldCharacterMilestone,
): number {
  return readTimeLabelSortYear(left.timeLabel) - readTimeLabelSortYear(right.timeLabel)
    || (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER)
    || KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    || left.title.localeCompare(right.title);
}

// Relationship-backed career records are listed before the shared profile
// milestones so an exact duplicate keeps the record's explicit label.
export function composeWorldCharacterMilestones(
  sharedMilestones: readonly SourceDetailWorldCharacterMilestone[],
  careerMilestones: readonly SourceDetailWorldCharacterMilestone[],
): SourceDetailWorldCharacterMilestone[] {
  return dedupeMilestones([...careerMilestones, ...sharedMilestones]).sort(compareWorldCharacterMilestones);
}

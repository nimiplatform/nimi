import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { SourceDetailWorldCharacterMilestone } from './source-detail-model.js';
import {
  readFiniteNumber,
  readMilestoneTimeLabel,
  readOptionalString,
  readRecordArray,
  readScalarString,
  readTimeLabelFromText,
  readYearLabel,
  slug,
} from './source-detail-model-readers.js';
import {
  isWorkLikeBiographyMilestone,
  mergeDistinctText,
  mergeTimeLabel,
  milestoneTexts,
  milestoneTitlesOverlap,
  normalizedCareerMergeText,
} from './source-detail-world-character-common.js';
import {
  isCareerRelationshipType,
  relationshipAttributes,
  relationshipCore,
  relationshipPresentation,
  readRelationshipId,
  readRelationshipLabel,
  readRelationshipSummary,
  readRelationshipTargetEntityId,
  readRelationshipType,
} from './source-detail-world-character-relationships.js';

type CareerMilestoneCandidate = SourceDetailWorldCharacterMilestone & {
  mergeKey: string;
};

function careerMilestoneKind(type: string): SourceDetailWorldCharacterMilestone['kind'] {
  if (type === 'postedToOffice') {
    return 'office';
  }
  return 'entry';
}

function readOfficeTitleFromSummary(summary: string | null): string | null {
  const match = summary?.match(/官至([^，。；、\s]+)/u)
    ?? summary?.match(/[任拜授为]([^，。；、\s]+(?:尚书|侍郎|学士|御史|知府|知州|知县|郎中|主事))/u);
  return match?.[1]?.trim() || null;
}

function readCareerMilestoneMergeKey(row: JsonObject, type: string, title: string, summary: string | null): string {
  const attributes = relationshipAttributes(row);
  const targetEntityId = readRelationshipTargetEntityId(row);
  if (targetEntityId) {
    return `${type}:target:${targetEntityId}`;
  }
  if (type === 'postedToOffice') {
    const officeId = readScalarString(attributes.officeId)
      ?? readScalarString(attributes.officeCode);
    if (officeId) {
      return `${type}:office:${officeId}`;
    }
    const officeLabel = readOptionalString(attributes, 'officeLabel') ?? title;
    const normalizedOfficeLabel = normalizedCareerMergeText(officeLabel);
    if (normalizedOfficeLabel) {
      return `${type}:office-label:${normalizedOfficeLabel}`;
    }
  }
  return `${type}:title:${normalizedCareerMergeText(title) || normalizedCareerMergeText(summary)}`;
}

export function readCareerMilestonesFromRelationships(relationships: JsonObject[]): SourceDetailWorldCharacterMilestone[] {
  const milestones = relationships
    .map((row, index): CareerMilestoneCandidate | null => {
      const type = readRelationshipType(row);
      if (!isCareerRelationshipType(type)) {
        return null;
      }
      const attributes = relationshipAttributes(row);
      const presentation = relationshipPresentation(row);
      const core = relationshipCore(row);
      const summary = readRelationshipSummary(row);
      const label = readRelationshipLabel(row)
        ?? (type === 'postedToOffice' ? readOfficeTitleFromSummary(summary) : null);
      const title = label ?? summary;
      if (!title) {
        return null;
      }
      const kind = careerMilestoneKind(type);
      return {
        id: `career-${readRelationshipId(row, `${type}-${index + 1}`)}`,
        mergeKey: readCareerMilestoneMergeKey(row, type, title, summary),
        title,
        summary,
        sequence: null,
        timeLabel: readMilestoneTimeLabel([attributes, presentation, core, row], [title, summary]),
        kind,
        derived: true,
      };
    })
    .filter((milestone): milestone is CareerMilestoneCandidate => Boolean(milestone))
    .sort((left, right) => {
      const order: Record<SourceDetailWorldCharacterMilestone['kind'], number> = {
        biography: 0,
        entry: 1,
        office: 2,
        work: 3,
      };
      return order[left.kind] - order[right.kind];
    });
  return dedupeCareerMilestones(milestones).map(stripCareerMilestoneMergeKey);
}

function mergeMilestone(
  left: SourceDetailWorldCharacterMilestone,
  right: SourceDetailWorldCharacterMilestone,
): SourceDetailWorldCharacterMilestone {
  return {
    ...left,
    summary: mergeDistinctText(left.summary, right.summary),
    sequence: left.sequence ?? right.sequence,
    timeLabel: mergeTimeLabel(left.timeLabel, right.timeLabel),
    kind: left.kind === 'biography' && right.kind !== 'biography' ? right.kind : left.kind,
    derived: left.derived || right.derived,
  };
}

function stripCareerMilestoneMergeKey(
  candidate: CareerMilestoneCandidate,
): SourceDetailWorldCharacterMilestone {
  const { mergeKey: _mergeKey, ...milestone } = candidate;
  return milestone;
}

function dedupeCareerMilestones(
  milestones: readonly CareerMilestoneCandidate[],
): CareerMilestoneCandidate[] {
  const result: CareerMilestoneCandidate[] = [];
  for (const milestone of milestones) {
    const existingIndex = result.findIndex((candidate) => (
      candidate.mergeKey === milestone.mergeKey
        || `${candidate.kind}:${candidate.title}` === `${milestone.kind}:${milestone.title}`
        || milestoneTitlesOverlap(candidate, milestone)
    ));
    if (existingIndex >= 0) {
      const existing = result[existingIndex];
      if (existing) {
        result[existingIndex] = {
          ...mergeMilestone(existing, milestone),
          mergeKey: existing.mergeKey || milestone.mergeKey,
        };
      }
      continue;
    }
    result.push(milestone);
  }
  return result;
}

function dedupeMilestones(
  milestones: readonly SourceDetailWorldCharacterMilestone[],
): SourceDetailWorldCharacterMilestone[] {
  const result: SourceDetailWorldCharacterMilestone[] = [];
  for (const milestone of milestones) {
    const existingIndex = result.findIndex((candidate) => (
      `${candidate.kind}:${candidate.title}` === `${milestone.kind}:${milestone.title}`
        || milestoneTitlesOverlap(candidate, milestone)
    ));
    if (existingIndex >= 0) {
      const existing = result[existingIndex];
      if (existing) {
        result[existingIndex] = mergeMilestone(existing, milestone);
      }
      continue;
    }
    result.push(milestone);
  }
  return result;
}

function milestoneSortValue(milestone: SourceDetailWorldCharacterMilestone): number {
  const fromTimeLabel = readYearLabel(milestone.timeLabel) ?? readTimeLabelFromText(milestone.timeLabel);
  if (fromTimeLabel) {
    const parsed = Number(fromTimeLabel.match(/\d{3,4}/u)?.[0]);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  const fromText = milestoneTexts(milestone).map(readTimeLabelFromText).find(Boolean);
  if (fromText) {
    const parsed = Number(fromText.match(/\d{3,4}/u)?.[0]);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

function sortMilestones(
  milestones: readonly SourceDetailWorldCharacterMilestone[],
): SourceDetailWorldCharacterMilestone[] {
  const order: Record<SourceDetailWorldCharacterMilestone['kind'], number> = {
    biography: 0,
    entry: 1,
    office: 2,
    work: 3,
  };
  return [...milestones].sort((left, right) => (
    milestoneSortValue(left) - milestoneSortValue(right)
      || (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER)
      || order[left.kind] - order[right.kind]
      || left.title.localeCompare(right.title)
  ));
}

function careerMilestoneMatchesAuthored(
  authored: SourceDetailWorldCharacterMilestone,
  career: SourceDetailWorldCharacterMilestone,
): boolean {
  const careerTitle = career.title.trim();
  const careerSummary = career.summary?.trim() ?? '';
  const authoredTexts = milestoneTexts(authored);
  return authoredTexts.some((text) => (
    text.includes(careerTitle)
      || (careerSummary.length > 0 && careerSummary.includes(text))
  ));
}

export function readWorldCharacterMilestones(
  sourceCore: JsonObject | null | undefined,
  careerMilestones: readonly SourceDetailWorldCharacterMilestone[],
): SourceDetailWorldCharacterMilestone[] {
  const biography = parseOptionalJsonObject(sourceCore?.biography);
  const authored = readRecordArray(biography?.milestones)
    .map((row, index): SourceDetailWorldCharacterMilestone | null => {
      const title = readOptionalString(row, 'title') ?? readOptionalString(row, 'summary');
      if (!title) {
        return null;
      }
      const summary = readOptionalString(row, 'summary');
      if (isWorkLikeBiographyMilestone(row, title, summary)) {
        return null;
      }
      const sequence = readFiniteNumber(row.sequence);
      return {
        id: readOptionalString(row, 'milestoneId')
          ?? readOptionalString(row, 'id')
          ?? slug(title, String(index + 1)),
        title,
        summary,
        sequence,
        timeLabel: readMilestoneTimeLabel([row], [title, summary]),
        kind: 'biography',
        derived: false,
      };
    })
    .filter((milestone): milestone is SourceDetailWorldCharacterMilestone => Boolean(milestone))
    .sort((left, right) => (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER));
  const mergedAuthored = authored.map((milestone) => {
    const career = careerMilestones.find((candidate) => careerMilestoneMatchesAuthored(milestone, candidate));
    if (!career) {
      return milestone;
    }
    return {
      ...milestone,
      summary: career.summary ?? milestone.summary,
      timeLabel: milestone.timeLabel ?? career.timeLabel,
      kind: career.kind,
      derived: true,
    };
  });
  const seen = new Set(mergedAuthored.map((milestone) => `${milestone.kind}:${milestone.title}`));
  const derived = careerMilestones.filter((milestone) => {
    if (mergedAuthored.some((authoredMilestone) => careerMilestoneMatchesAuthored(authoredMilestone, milestone))) {
      return false;
    }
    const key = `${milestone.kind}:${milestone.title}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return sortMilestones(dedupeMilestones([...mergedAuthored, ...derived]));
}

import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { SourceDetailWorkCollection } from './source-detail-model.js';
import {
  readMilestoneTimeLabel,
  readOptionalString,
  readPath,
  readRecordArray,
  readScalarString,
  slug,
} from './source-detail-model-readers.js';
import {
  isWorkLikeBiographyMilestone,
  mergeDistinctText,
  mergeTimeLabel,
  normalizeWorkStatus,
  normalizedWorkMergeText,
  readWorkTitle,
  readWorkTitleFromText,
} from './source-detail-world-character-common.js';
import {
  isWorkRelationshipType,
  relationshipAttributes,
  relationshipCore,
  relationshipPresentation,
  readRelationshipId,
  readRelationshipLabel,
  readRelationshipSummary,
  readRelationshipTargetLabel,
  readRelationshipType,
} from './source-detail-world-character-relationships.js';

function toWorkCollection(row: JsonObject, index: number): SourceDetailWorkCollection | null {
  const title = readWorkTitle(row);
  if (!title) {
    return null;
  }
  const textId = readScalarString(row.textId);
  const rowRef = readScalarString(row.rowRef);
  const hasNativeTitle = Boolean(
    readOptionalString(row, 'titleChn')
    ?? readOptionalString(row, 'titleZh')
    ?? readOptionalString(row, 'chineseTitle')
    ?? readOptionalString(row, 'displayTitle')
    ?? readOptionalString(row, 'name'),
  );
  return {
    id: readScalarString(row.id)
      ?? readScalarString(row.workId)
      ?? (textId ? `text-${textId}` : null)
      ?? rowRef
      ?? slug(title, String(index + 1)),
    title,
    romanizedTitle: hasNativeTitle ? readOptionalString(row, 'title') : readOptionalString(row, 'romanizedTitle'),
    textId,
    rowRef,
    role: readOptionalString(row, 'role') ?? readOptionalString(row, 'relationRole'),
    status: normalizeWorkStatus(row.joinStatus ?? row.status),
  };
}

export function readWorldCharacterWorks(sourceCore: JsonObject | null | undefined): SourceDetailWorkCollection[] {
  const candidateRows = [
    readPath(sourceCore, ['authoring', 'extensions', 'sourcePerson', 'texts']),
    readPath(sourceCore, ['authoring', 'extensions', 'cbdb', 'sourcePerson', 'texts']),
    readPath(sourceCore, ['authoring', 'extensions', 'cbdb', 'texts']),
    readPath(sourceCore, ['authoring', 'extensions', 'works']),
    readPath(sourceCore, ['sourcePerson', 'texts']),
    readPath(sourceCore, ['works']),
  ].flatMap(readRecordArray);
  const seen = new Set<string>();
  return candidateRows
    .map(toWorkCollection)
    .filter((work): work is SourceDetailWorkCollection => Boolean(work))
    .filter((work) => {
      const key = work.textId ?? work.rowRef ?? work.title;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function toWorkCollectionFromRelationship(row: JsonObject, index: number): SourceDetailWorkCollection | null {
  const type = readRelationshipType(row);
  if (!isWorkRelationshipType(type)) {
    return null;
  }
  const attributes = relationshipAttributes(row);
  const presentation = relationshipPresentation(row);
  const core = relationshipCore(row);
  const summary = readRelationshipSummary(row);
  const targetTextRef = readScalarString(row.targetEntityId)
    ?? readScalarString(row.targetRef)
    ?? readScalarString(core.targetEntityId);
  const targetTextId = targetTextRef?.replace(/^cbdb-text-/u, '') ?? null;
  const textId = readScalarString(attributes.textId)
    ?? readScalarString(attributes.textCode)
    ?? targetTextId;
  const title = readWorkTitle(attributes)
    ?? readOptionalString(presentation, 'title')
    ?? readRelationshipTargetLabel(row)
    ?? readRelationshipLabel(row)
    ?? readWorkTitleFromText(summary);
  if (!title) {
    return null;
  }
  return {
    id: readRelationshipId(row, textId ? `text-${textId}` : slug(title, String(index + 1))),
    title,
    romanizedTitle: readOptionalString(attributes, 'title')
      ?? readOptionalString(attributes, 'romanizedTitle'),
    textId,
    rowRef: readScalarString(attributes.rowRef),
    role: readOptionalString(attributes, 'role') ?? readOptionalString(attributes, 'relationRole'),
    status: normalizeWorkStatus(attributes.joinStatus ?? row.joinStatus ?? attributes.status),
    summary: isGenericWorkSummary(title, summary) ? null : summary,
    timeLabel: readMilestoneTimeLabel([attributes, presentation, core, row], [title, summary]),
  };
}

function worksHaveConflictingTextIds(
  left: SourceDetailWorkCollection,
  right: SourceDetailWorkCollection,
): boolean {
  return Boolean(left.textId && right.textId && left.textId !== right.textId);
}

function worksReferToSameCollection(
  left: SourceDetailWorkCollection,
  right: SourceDetailWorkCollection,
): boolean {
  if (left.textId && right.textId) {
    return left.textId === right.textId;
  }
  if (left.rowRef && right.rowRef && left.rowRef === right.rowRef) {
    return true;
  }
  const leftTitle = normalizedWorkMergeText(left.title);
  const rightTitle = normalizedWorkMergeText(right.title);
  return Boolean(
    leftTitle
      && rightTitle
      && leftTitle === rightTitle
      && !worksHaveConflictingTextIds(left, right),
  );
}

function isGenericWorkSummary(title: string, summary: string | null | undefined): boolean {
  const normalizedTitle = normalizedWorkMergeText(title);
  const normalizedSummary = normalizedWorkMergeText(summary);
  if (!normalizedTitle || !normalizedSummary) {
    return false;
  }
  return normalizedSummary === normalizedTitle
    || normalizedSummary === `著有${normalizedTitle}`
    || normalizedSummary === `撰有${normalizedTitle}`
    || normalizedSummary === `著作${normalizedTitle}`
    || normalizedSummary === `${normalizedTitle}有关`
    || normalizedSummary.endsWith(`著有${normalizedTitle}`)
    || normalizedSummary.endsWith(`撰有${normalizedTitle}`)
    || normalizedSummary.endsWith(`著作${normalizedTitle}`)
    || normalizedSummary.endsWith(`与著作${normalizedTitle}有关`)
    || normalizedSummary.endsWith(`与作品${normalizedTitle}有关`);
}

function mergeWorkStatus(
  left: SourceDetailWorkCollection['status'],
  right: SourceDetailWorkCollection['status'],
): SourceDetailWorkCollection['status'] {
  if (left === 'resolved' || right === 'resolved') {
    return 'resolved';
  }
  if (left === 'unresolved' || right === 'unresolved') {
    return 'unresolved';
  }
  return 'unknown';
}

function workDisplayScore(work: SourceDetailWorkCollection): number {
  const normalizedSummary = normalizedWorkMergeText(work.summary);
  let score = normalizedWorkMergeText(work.title) ? 1 : 0;
  if (normalizedSummary) {
    score += 8 + Math.min(normalizedSummary.length, 80) / 10;
    if (isGenericWorkSummary(work.title, work.summary)) {
      score -= 7;
    }
  }
  if (work.romanizedTitle) {
    score += 0.25;
  }
  if (work.timeLabel) {
    score += 0.25;
  }
  return score;
}

function chooseWorkDisplayBase(
  left: SourceDetailWorkCollection,
  right: SourceDetailWorkCollection,
): SourceDetailWorkCollection {
  const leftScore = workDisplayScore(left);
  const rightScore = workDisplayScore(right);
  return rightScore >= leftScore ? right : left;
}

function workTitleEvidenceScore(work: SourceDetailWorkCollection): number {
  const normalizedTitle = normalizedWorkMergeText(work.title);
  const normalizedSummary = normalizedWorkMergeText(work.summary);
  if (!normalizedTitle) {
    return 0;
  }
  let score = 1;
  if (normalizedSummary.includes(normalizedTitle)) {
    score += 4;
  }
  score += 1 / Math.max(normalizedTitle.length, 1);
  return score;
}

function chooseWorkTitle(
  left: SourceDetailWorkCollection,
  right: SourceDetailWorkCollection,
  display: SourceDetailWorkCollection,
): string {
  const leftTitle = normalizedWorkMergeText(left.title);
  const rightTitle = normalizedWorkMergeText(right.title);
  if (leftTitle && rightTitle && leftTitle === rightTitle) {
    return display.title;
  }
  const leftScore = workTitleEvidenceScore(left);
  const rightScore = workTitleEvidenceScore(right);
  if (leftScore === rightScore) {
    return display.title;
  }
  return rightScore > leftScore ? right.title : left.title;
}

function mergeWorkCollection(
  left: SourceDetailWorkCollection,
  right: SourceDetailWorkCollection,
): SourceDetailWorkCollection {
  const display = chooseWorkDisplayBase(left, right);
  const fallback = display === left ? right : left;
  return {
    ...display,
    title: chooseWorkTitle(left, right, display),
    romanizedTitle: display.romanizedTitle ?? fallback.romanizedTitle,
    textId: display.textId ?? fallback.textId,
    rowRef: display.rowRef ?? fallback.rowRef,
    role: mergeDistinctText(display.role, fallback.role),
    status: mergeWorkStatus(display.status, fallback.status),
    summary: display.summary ?? fallback.summary,
    timeLabel: mergeTimeLabel(display.timeLabel ?? null, fallback.timeLabel ?? null),
  };
}

export function dedupeWorks(works: SourceDetailWorkCollection[]): SourceDetailWorkCollection[] {
  const result: SourceDetailWorkCollection[] = [];
  for (const work of works) {
    const existingIndex = result.findIndex((candidate) => worksReferToSameCollection(candidate, work));
    if (existingIndex >= 0) {
      const existing = result[existingIndex];
      if (existing) {
        result[existingIndex] = mergeWorkCollection(existing, work);
      }
      continue;
    }
    result.push(work);
  }
  return result;
}

export function readWorldCharacterWorksFromRelationships(relationships: JsonObject[]): SourceDetailWorkCollection[] {
  return relationships
    .map(toWorkCollectionFromRelationship)
    .filter((work): work is SourceDetailWorkCollection => Boolean(work));
}

function toWorkCollectionFromBiographyMilestone(
  row: JsonObject,
  index: number,
): SourceDetailWorkCollection | null {
  const rawTitle = readOptionalString(row, 'title');
  const summary = readOptionalString(row, 'summary');
  if (!isWorkLikeBiographyMilestone(row, rawTitle, summary)) {
    return null;
  }
  const title = readWorkTitleFromText(rawTitle)
    ?? readWorkTitleFromText(summary)
    ?? readOptionalString(row, 'titleChn')
    ?? readOptionalString(row, 'titleZh')
    ?? readOptionalString(row, 'chineseTitle')
    ?? readOptionalString(row, 'displayTitle')
    ?? readOptionalString(row, 'name')
    ?? rawTitle
    ?? summary;
  if (!title) {
    return null;
  }
  const textId = readScalarString(row.textId);
  return {
    id: readOptionalString(row, 'workId')
      ?? readOptionalString(row, 'milestoneId')
      ?? readOptionalString(row, 'id')
      ?? (textId ? `text-${textId}` : null)
      ?? slug(title, String(index + 1)),
    title,
    romanizedTitle: readOptionalString(row, 'romanizedTitle'),
    textId,
    rowRef: readScalarString(row.rowRef),
    role: readOptionalString(row, 'role') ?? readOptionalString(row, 'relationRole'),
    status: normalizeWorkStatus(row.joinStatus ?? row.status),
    summary: isGenericWorkSummary(title, summary) ? null : summary,
    timeLabel: readMilestoneTimeLabel([row], [rawTitle, summary]),
  };
}

export function readWorldCharacterWorksFromBiography(
  sourceCore: JsonObject | null | undefined,
): SourceDetailWorkCollection[] {
  const biography = parseOptionalJsonObject(sourceCore?.biography);
  return readRecordArray(biography?.milestones)
    .map(toWorkCollectionFromBiographyMilestone)
    .filter((work): work is SourceDetailWorkCollection => Boolean(work));
}

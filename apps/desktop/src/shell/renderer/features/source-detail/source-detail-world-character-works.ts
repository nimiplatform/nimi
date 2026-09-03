import type { JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { SourceDetailWorkCollection } from './source-detail-model.js';
import {
  readMilestoneTimeLabel,
  readOptionalString,
  readScalarString,
  slug,
} from './source-detail-model-readers.js';
import {
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
    ?? readWorkTitleFromText(summary);
  // Rows without an identifiable work title are literary-exchange evidence,
  // not works. Keep them as text clues titled by the generic relation label
  // (e.g. 著述线索) so they render separately from real work cards.
  const textClue = !title;
  const resolvedTitle = title ?? readRelationshipLabel(row) ?? summary;
  if (!resolvedTitle || (textClue && !summary)) {
    return null;
  }
  return {
    id: readRelationshipId(row, textId ? ['text', textId].join('-') : slug(resolvedTitle, String(index + 1))),
    title: resolvedTitle,
    romanizedTitle: readOptionalString(attributes, 'title')
      ?? readOptionalString(attributes, 'romanizedTitle'),
    textId,
    rowRef: readScalarString(attributes.rowRef),
    role: readOptionalString(attributes, 'role') ?? readOptionalString(attributes, 'relationRole'),
    status: normalizeWorkStatus(attributes.joinStatus ?? row.joinStatus ?? attributes.status),
    summary: textClue || !isGenericWorkSummary(resolvedTitle, summary) ? summary : null,
    timeLabel: readMilestoneTimeLabel([attributes, presentation, core, row], [resolvedTitle, summary]),
    ...(textClue ? { textClue: true } : {}),
  };
}

function worksReferToSameCollection(
  left: SourceDetailWorkCollection,
  right: SourceDetailWorkCollection,
): boolean {
  if (left.textId && right.textId && left.textId === right.textId) {
    return true;
  }
  if (left.rowRef && right.rowRef && left.rowRef === right.rowRef) {
    return true;
  }
  // Text clues all share the same generic relation label, so title equality
  // would wrongly collapse distinct evidence rows; only explicit ids merge.
  if (left.textClue || right.textClue) {
    return false;
  }
  const leftTitle = normalizedWorkMergeText(left.title);
  const rightTitle = normalizedWorkMergeText(right.title);
  return Boolean(
    leftTitle
      && rightTitle
      && leftTitle === rightTitle,
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

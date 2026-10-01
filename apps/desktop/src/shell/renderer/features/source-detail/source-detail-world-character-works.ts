import type { JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { SourceDetailWorkCollection } from './source-detail-model.js';
import {
  readOptionalString,
  readScalarString,
  slug,
} from './source-detail-model-readers.js';
import {
  mergeDistinctText,
  mergeTimeLabel,
  normalizeWorkStatus,
  normalizedMergeText,
  readWorkTitle,
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
  readRelationshipTimeLabel,
  readRelationshipType,
} from './source-detail-world-character-relationships.js';

// A work comes only from a relationship row with an explicit work type. Its
// title comes only from explicit title fields; titles are never parsed out of
// summaries or other prose.
function toWorkCollectionFromRelationship(row: JsonObject, index: number): SourceDetailWorkCollection | null {
  const type = readRelationshipType(row);
  if (!isWorkRelationshipType(type)) {
    return null;
  }
  const attributes = relationshipAttributes(row);
  const presentation = relationshipPresentation(row);
  const core = relationshipCore(row);
  const summary = readRelationshipSummary(row);
  const textId = readScalarString(attributes.textId)
    ?? readScalarString(attributes.textCode)
    ?? readScalarString(row.targetEntityId)
    ?? readScalarString(row.targetRef)
    ?? readScalarString(core.targetEntityId);
  const title = readWorkTitle(attributes)
    ?? readOptionalString(presentation, 'title')
    ?? readRelationshipTargetLabel(row);
  // Rows without an explicit work title are writing evidence, not works. Keep
  // them as text clues titled by their relation label so they render
  // separately from real work cards.
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
    summary: textClue || !isTitleOnlySummary(resolvedTitle, summary) ? summary : null,
    timeLabel: readRelationshipTimeLabel(row),
    ...(textClue ? { textClue: true } : {}),
  };
}

// Two work records name the same collection only through an explicit id or an
// identical explicit title.
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
  const leftTitle = normalizedMergeText(left.title);
  const rightTitle = normalizedMergeText(right.title);
  return Boolean(leftTitle && rightTitle && leftTitle === rightTitle);
}

// A summary that only repeats the title adds nothing to the work card.
function isTitleOnlySummary(title: string, summary: string | null | undefined): boolean {
  const normalizedTitle = normalizedMergeText(title);
  return Boolean(normalizedTitle) && normalizedMergeText(summary) === normalizedTitle;
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

function hasExplicitWorkIdentity(work: SourceDetailWorkCollection): boolean {
  return Boolean(work.textId || work.rowRef);
}

// The record backed by an explicit text id or row reference is the display
// base; the other record only fills fields the base leaves empty.
function mergeWorkCollection(
  left: SourceDetailWorkCollection,
  right: SourceDetailWorkCollection,
): SourceDetailWorkCollection {
  const display = !hasExplicitWorkIdentity(left) && hasExplicitWorkIdentity(right) ? right : left;
  const fallback = display === left ? right : left;
  return {
    ...display,
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

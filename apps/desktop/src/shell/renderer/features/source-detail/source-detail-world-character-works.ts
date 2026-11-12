import type { JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { SourceDetailData, SourceDetailWorkCollection } from './source-detail-model.js';
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
  readRelationshipTargetEntityId,
  readRelationshipTargetLabel,
  readRelationshipTimeLabel,
  readRelationshipType,
} from './source-detail-world-character-relationships.js';

// A work comes only from a relationship row with an explicit work type. Its
// title comes only from explicit title fields; titles are never parsed out of
// summaries or other prose.
function toWorkCollectionFromRelationship(
  row: JsonObject,
  index: number,
  targets: SourceDetailData['relationshipTargets'],
): SourceDetailWorkCollection | null {
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
  const targetId = readRelationshipTargetEntityId(row);
  const target = targetId ? targets[targetId] : null;
  const targetTitle = target && ['text', 'work'].includes(target.kind) && !target.isCharacter
    ? target.name : null;
  const title = readWorkTitle(attributes)
    ?? readOptionalString(presentation, 'title')
    ?? readRelationshipTargetLabel(row)
    ?? targetTitle;
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

function haveConflictingTextIds(
  left: SourceDetailWorkCollection,
  right: SourceDetailWorkCollection,
): boolean {
  return Boolean(left.textId && right.textId && left.textId !== right.textId);
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
  // A title-only milestone can fill a work record when the title is unambiguous.
  // Count explicit identities across the whole input so the result cannot
  // assign that milestone to whichever of two same-title works arrives first.
  const textIdsByTitle = new Map<string, Set<string>>();
  for (const work of works) {
    const title = normalizedMergeText(work.title);
    if (work.textClue || !title || !work.textId) continue;
    const ids = textIdsByTitle.get(title) ?? new Set<string>();
    ids.add(work.textId);
    textIdsByTitle.set(title, ids);
  }

  const result: SourceDetailWorkCollection[] = [];
  for (const work of works) {
    let existingIndex = work.textId
      ? result.findIndex(candidate => candidate.textId === work.textId)
      : -1;
    if (existingIndex < 0 && work.rowRef) {
      existingIndex = result.findIndex(candidate => candidate.rowRef === work.rowRef
        && !haveConflictingTextIds(candidate, work));
    }
    const title = normalizedMergeText(work.title);
    if (existingIndex < 0 && !work.textClue && title && (textIdsByTitle.get(title)?.size ?? 0) <= 1) {
      existingIndex = result.findIndex(candidate => !candidate.textClue
        && !haveConflictingTextIds(candidate, work)
        && normalizedMergeText(candidate.title) === title);
    }
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

export function readWorldCharacterWorksFromRelationships(
  relationships: JsonObject[],
  targets: SourceDetailData['relationshipTargets'] = {},
): SourceDetailWorkCollection[] {
  return relationships
    .map((row, index) => toWorkCollectionFromRelationship(row, index, targets))
    .filter((work): work is SourceDetailWorkCollection => Boolean(work));
}

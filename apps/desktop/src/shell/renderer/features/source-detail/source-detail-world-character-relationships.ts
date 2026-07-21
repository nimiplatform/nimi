import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type {
  SourceDetailRelationshipClue,
  SourceDetailWorldCharacterRelationshipNote,
} from './source-detail-model.js';
import {
  readMilestoneTimeLabel,
  readOptionalString,
  readRecordArray,
  readScalarString,
} from './source-detail-model-readers.js';
import { readWorkTitle } from './source-detail-world-character-common.js';

export function relationshipCore(record: JsonObject): JsonObject {
  return parseOptionalJsonObject(record.core) ?? record;
}

export function relationshipAttributes(record: JsonObject): JsonObject {
  const core = relationshipCore(record);
  return parseOptionalJsonObject(core.attributes)
    ?? parseOptionalJsonObject(record.attributes)
    ?? {};
}

export function relationshipPresentation(record: JsonObject): JsonObject {
  return parseOptionalJsonObject(relationshipCore(record).presentation) ?? {};
}

export function readRelationshipType(record: JsonObject): string | null {
  const core = relationshipCore(record);
  const endpoints = parseOptionalJsonObject(core.endpoints);
  return readOptionalString(record, 'type')
    ?? readOptionalString(endpoints, 'type')
    ?? readOptionalString(record, 'relationType')
    ?? readOptionalString(record, 'kind');
}

export const CAREER_RELATIONSHIP_TYPES = ['entry', 'postedToOffice'] as const;
export const WORK_RELATIONSHIP_TYPES = ['text', 'authoredText'] as const;


export function isCareerRelationshipType(type: string | null): type is string {
  return Boolean(type && CAREER_RELATIONSHIP_TYPES.includes(type as (typeof CAREER_RELATIONSHIP_TYPES)[number]));
}

export function isWorkRelationshipType(type: string | null): type is string {
  return Boolean(type && WORK_RELATIONSHIP_TYPES.includes(type as (typeof WORK_RELATIONSHIP_TYPES)[number]));
}

export function readRelationshipSummary(record: JsonObject): string | null {
  const presentation = relationshipPresentation(record);
  return readOptionalString(presentation, 'summary')
    ?? readOptionalString(record, 'summary');
}

export function readRelationshipId(record: JsonObject, fallback: string): string {
  return readOptionalString(record, 'id')
    ?? readOptionalString(record, 'relationshipId')
    ?? readOptionalString(record, 'contentHash')
    ?? fallback;
}

export function readRelationshipRows(value: unknown): JsonObject[] {
  return readRecordArray(value);
}

export function readRelationshipTargetEntityId(row: JsonObject): string | null {
  const core = relationshipCore(row);
  return readScalarString(row.targetEntityId)
    ?? readScalarString(core.targetEntityId);
}

export function readRelationshipLabel(row: JsonObject): string | null {
  const attributes = relationshipAttributes(row);
  const presentation = relationshipPresentation(row);
  const type = readRelationshipType(row);
  if (type === 'postedAddress' || type === 'biogAddress') {
    return readOptionalString(attributes, 'addressLabel')
      ?? readOptionalString(attributes, 'placeLabel')
      ?? readOptionalString(attributes, 'targetLabel')
      ?? readOptionalString(attributes, 'label')
      ?? readOptionalString(presentation, 'title');
  }
  return readOptionalString(attributes, 'officeLabel')
    ?? readOptionalString(attributes, 'statusLabel')
    ?? readOptionalString(attributes, 'entryLabel')
    ?? readOptionalString(attributes, 'addressLabel')
    ?? readOptionalString(attributes, 'placeLabel')
    ?? readOptionalString(attributes, 'sourceRelationLabelChn')
    ?? readOptionalString(attributes, 'sourceRelationLabel')
    ?? readOptionalString(attributes, 'targetLabel')
    ?? readOptionalString(attributes, 'label')
    ?? readWorkTitle(attributes)
    ?? readOptionalString(presentation, 'title');
}

function formatRelationshipTimePhrase(timeLabel: string | null): string | null {
  if (!timeLabel) {
    return null;
  }
  return /[年月日）)]$/u.test(timeLabel) ? timeLabel : `${timeLabel}年`;
}

function readPostedAddressDetail(row: JsonObject, label: string, summary: string | null): string | null {
  const attributes = relationshipAttributes(row);
  const presentation = relationshipPresentation(row);
  const core = relationshipCore(row);
  const officeLabel = readOptionalString(attributes, 'officeLabel');
  const timeLabel = readMilestoneTimeLabel([attributes, presentation, core, row], [summary, label]);
  const timePhrase = formatRelationshipTimePhrase(timeLabel);
  if (officeLabel && timePhrase) {
    return `${timePhrase}任${officeLabel}，地点「${label}」。`;
  }
  if (officeLabel) {
    return `任${officeLabel}，地点「${label}」。`;
  }
  if (timePhrase) {
    return `${timePhrase}任官或活动记录关联地点「${label}」。`;
  }
  return null;
}

function readRelationshipDetail(row: JsonObject, type: string, label: string, summary: string | null): string | null {
  if (type === 'postedAddress') {
    return readPostedAddressDetail(row, label, summary);
  }
  return null;
}

export function readRelationshipTargetLabel(row: JsonObject): string | null {
  const attributes = relationshipAttributes(row);
  const presentation = relationshipPresentation(row);
  return readOptionalString(attributes, 'targetLabel')
    ?? readOptionalString(attributes, 'targetName')
    ?? readOptionalString(presentation, 'targetLabel')
    ?? readOptionalString(presentation, 'targetName');
}

export function readRelationshipClues(relationships: JsonObject[]): SourceDetailRelationshipClue[] {
  const seen = new Set<string>();
  return relationships
    .map((row, index): SourceDetailRelationshipClue | null => {
      const type = readRelationshipType(row);
      if (!type || isCareerRelationshipType(type) || isWorkRelationshipType(type)) {
        return null;
      }
      const label = readRelationshipLabel(row);
      const summary = readRelationshipSummary(row);
      if (!label && !summary) {
        return null;
      }
      return {
        id: readRelationshipId(row, `${type}-${index + 1}`),
        type,
        label: label ?? summary ?? type,
        targetLabel: readRelationshipTargetLabel(row),
        summary,
        detail: readRelationshipDetail(row, type, label ?? summary ?? type, summary),
      };
    })
    .filter((clue): clue is SourceDetailRelationshipClue => Boolean(clue))
    .filter((clue) => {
      const key = `${clue.type}:${clue.label}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

export function readWorldCharacterRelationshipNotes(sourceCore: JsonObject | null | undefined): SourceDetailWorldCharacterRelationshipNote[] {
  return readRecordArray(sourceCore?.relationships)
    .map((row, index): SourceDetailWorldCharacterRelationshipNote | null => {
      const summary = readOptionalString(row, 'summary');
      const type = readOptionalString(row, 'relationType')
        ?? readOptionalString(row, 'type');
      if (!summary || !type || isCareerRelationshipType(type) || isWorkRelationshipType(type)) {
        return null;
      }
      const targetRef = readOptionalString(row, 'targetRef');
      return {
        id: readOptionalString(row, 'id')
          ?? (targetRef ? `${type}-${targetRef}` : null)
          ?? `${type}-${index + 1}`,
        type,
        targetRef,
        summary,
      };
    })
    .filter((note): note is SourceDetailWorldCharacterRelationshipNote => Boolean(note))
    .slice(0, 12);
}

import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { SourceDetailRelationshipClue } from './source-detail-model.js';
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

// The explicit relationship type declared by the record, or null when the
// record declares none. Callers present a null type neutrally.
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
export const ADDRESS_RELATIONSHIP_TYPES = ['postedAddress', 'biogAddress'] as const;

export function isCareerRelationshipType(type: string | null): type is string {
  return Boolean(type && CAREER_RELATIONSHIP_TYPES.includes(type as (typeof CAREER_RELATIONSHIP_TYPES)[number]));
}

export function isWorkRelationshipType(type: string | null): type is string {
  return Boolean(type && WORK_RELATIONSHIP_TYPES.includes(type as (typeof WORK_RELATIONSHIP_TYPES)[number]));
}

export function isAddressRelationshipType(type: string | null): type is string {
  return Boolean(type && ADDRESS_RELATIONSHIP_TYPES.includes(type as (typeof ADDRESS_RELATIONSHIP_TYPES)[number]));
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
  if (isAddressRelationshipType(type)) {
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

export function readRelationshipTargetLabel(row: JsonObject): string | null {
  const attributes = relationshipAttributes(row);
  const presentation = relationshipPresentation(row);
  return readOptionalString(attributes, 'targetLabel')
    ?? readOptionalString(attributes, 'targetName')
    ?? readOptionalString(presentation, 'targetLabel')
    ?? readOptionalString(presentation, 'targetName');
}

export function readRelationshipTimeLabel(row: JsonObject): string | null {
  return readMilestoneTimeLabel([
    relationshipAttributes(row),
    relationshipPresentation(row),
    relationshipCore(row),
    row,
  ]);
}

// Additional explicit fields a clue carries beyond its label, target, and
// summary (for example the office held at a posted address, or the record's
// time), shown as authored.
function readRelationshipClueDetails(row: JsonObject, label: string | null): string[] {
  const officeLabel = readOptionalString(relationshipAttributes(row), 'officeLabel');
  const details: string[] = [];
  for (const value of [officeLabel, readRelationshipTimeLabel(row)]) {
    if (value && value !== label && !details.includes(value)) {
      details.push(value);
    }
  }
  return details;
}

export function readRelationshipTargetLabels(relationships: JsonObject[]): Record<string, string> {
  const labels = new Map<string, string>();
  for (const row of relationships) {
    const entityId = readRelationshipTargetEntityId(row);
    if (!entityId || labels.has(entityId)) {
      continue;
    }
    const label = readRelationshipTargetLabel(row) ?? readRelationshipLabel(row);
    if (label && label !== entityId) {
      labels.set(entityId, label);
    }
  }
  return Object.fromEntries(labels);
}

// Relationship rows other than career and work rows (which render as
// milestones and works). A row without an explicit type is kept and presented
// neutrally; only a row with no displayable text at all is omitted.
export function readRelationshipClues(relationships: JsonObject[]): SourceDetailRelationshipClue[] {
  const seen = new Set<string>();
  const clues: SourceDetailRelationshipClue[] = [];
  relationships.forEach((row, index) => {
    const type = readRelationshipType(row);
    if (isCareerRelationshipType(type) || isWorkRelationshipType(type)) {
      return;
    }
    const label = readRelationshipLabel(row);
    const targetLabel = readRelationshipTargetLabel(row);
    const summary = readRelationshipSummary(row);
    if (!label && !targetLabel && !summary) {
      return;
    }
    const targetEntityId = readRelationshipTargetEntityId(row);
    const key = [type, label, targetLabel, targetEntityId, summary].map((value) => value ?? '').join('\u0000');
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    clues.push({
      id: readRelationshipId(row, `relationship-${index + 1}`),
      type,
      label,
      targetLabel,
      targetEntityId,
      summary,
      details: readRelationshipClueDetails(row, label),
    });
  });
  return clues.slice(0, 12);
}

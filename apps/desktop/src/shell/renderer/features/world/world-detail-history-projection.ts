import type {
  WorldHistoryBundle,
  WorldHistoryEvidenceRef,
  WorldHistoryItem,
  WorldHistorySummary,
} from './world-detail-types.js';
import {
  asRecord,
  formatMixedLabel,
  readNumber,
  readRecordArray,
  readString,
  readStringArray,
} from './world-detail-query-readers.js';

export function toWorldDisplayHistoryItem(rawValue: unknown, index: number): WorldHistoryItem {
  const raw = asRecord(rawValue);
  const id = readString(raw, 'id', 'eventId') || `world-history-${index + 1}`;
  const eventType = readString(raw, 'eventType', 'type');
  const happenedAt = readString(raw, 'happenedAt', 'timestamp', 'timeRef', 'time', 'createdAt') || new Date(0).toISOString();
  const eventTypeLower = eventType.toLowerCase();
  const eventHorizon = eventTypeLower.includes('future')
    ? 'FUTURE'
    : eventTypeLower.includes('ongoing')
      ? 'ONGOING'
      : 'PAST';
  const evidenceRefs: WorldHistoryEvidenceRef[] = readRecordArray(raw.evidenceRefs).map((evidence, evidenceIndex) => ({
    segmentId: readString(evidence, 'segmentId') || `${id}-evidence-${evidenceIndex + 1}`,
    offsetStart: readNumber(evidence.offsetStart) ?? 0,
    offsetEnd: readNumber(evidence.offsetEnd) ?? 0,
    excerpt: readString(evidence, 'excerpt'),
    confidence: readNumber(evidence.confidence) ?? 0,
    sourceType: readString(evidence, 'sourceType') || 'WORLD_CORE',
  }));
  return {
    id,
    timelineSeq: readNumber(raw.timelineSeq) ?? readNumber(raw.sequence) ?? index + 1,
    title: readString(raw, 'title', 'name', 'summary') || 'World event',
    description: readString(raw, 'description', 'summary', 'cause', 'process', 'result'),
    time: readString(raw, 'timeRef', 'time') || happenedAt,
    tag: eventType ? formatMixedLabel(eventType) : ({ PAST: 'Past', ONGOING: 'Ongoing', FUTURE: 'Future' }[eventHorizon]),
    level: eventTypeLower.includes('secondary') ? 'SECONDARY' : 'PRIMARY',
    eventHorizon,
    summary: readString(raw, 'summary') || null,
    cause: readString(raw, 'cause') || null,
    process: readString(raw, 'process') || null,
    result: readString(raw, 'result') || null,
    locationRefs: readStringArray(raw.locationRefs).length ? readStringArray(raw.locationRefs) : readStringArray(raw.sceneRefs),
    characterRefs: readStringArray(raw.characterRefs).length ? readStringArray(raw.characterRefs) : readStringArray(raw.entityRefs),
    evidenceRefs,
    confidence: evidenceRefs.length > 0
      ? evidenceRefs.reduce((sum, item) => sum + item.confidence, 0) / evidenceRefs.length
      : 0,
    needsEvidence: evidenceRefs.length === 0,
  };
}

function buildWorldHistorySummary(items: readonly WorldHistoryItem[]): WorldHistorySummary | null {
  if (items.length === 0) {
    return null;
  }
  const primaryCount = items.filter((item) => item.level === 'PRIMARY').length;
  const secondaryCount = items.length - primaryCount;
  return {
    primaryCount,
    secondaryCount,
    totalCount: items.length,
    eventCharacterCoverage: items.filter((item) => item.characterRefs.length > 0).length / items.length,
    eventLocationCoverage: items.filter((item) => item.locationRefs.length > 0).length / items.length,
  };
}

export function toWorldDisplayHistoryBundle(raw: { readonly items?: readonly unknown[] }): WorldHistoryBundle {
  const items = (raw.items ?? [])
    .map((item, index) => toWorldDisplayHistoryItem(item, index))
    .sort((left, right) => left.timelineSeq - right.timelineSeq || left.id.localeCompare(right.id));
  return {
    items,
    summary: buildWorldHistorySummary(items),
  };
}

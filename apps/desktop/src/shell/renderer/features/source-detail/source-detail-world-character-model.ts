import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type {
  SourceDetailRelationshipClue,
  SourceDetailWorkCollection,
  SourceDetailWorldCharacter,
  SourceDetailWorldCharacterInteraction,
  SourceDetailWorldCharacterMilestone,
  SourceDetailWorldCharacterRelationshipNote,
} from './source-detail-model.js';
import {
  readFiniteNumber,
  readMilestoneTimeLabel,
  readOptionalString,
  readPath,
  readRecordArray,
  readScalarString,
  readStringArray,
  readTimeLabelFromText,
  readYearLabel,
  slug,
} from './source-detail-model-readers.js';
import { simplifySourceDetailChineseText } from './source-detail-simplified-chinese.js';

function normalizeWorkStatus(value: unknown): SourceDetailWorkCollection['status'] {
  const status = readScalarString(value)?.toLocaleLowerCase();
  if (status === 'resolved' || status === 'unresolved') {
    return status;
  }
  return 'unknown';
}

function readWorkTitle(row: JsonObject): string | null {
  return readOptionalString(row, 'titleChn')
    ?? readOptionalString(row, 'titleZh')
    ?? readOptionalString(row, 'chineseTitle')
    ?? readOptionalString(row, 'displayTitle')
    ?? readOptionalString(row, 'name')
    ?? readOptionalString(row, 'title');
}

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

function relationshipCore(record: JsonObject): JsonObject {
  return parseOptionalJsonObject(record.core) ?? record;
}

function relationshipAttributes(record: JsonObject): JsonObject {
  const core = relationshipCore(record);
  return parseOptionalJsonObject(core.attributes)
    ?? parseOptionalJsonObject(record.attributes)
    ?? {};
}

function relationshipPresentation(record: JsonObject): JsonObject {
  return parseOptionalJsonObject(relationshipCore(record).presentation) ?? {};
}

function readRelationshipType(record: JsonObject): string | null {
  const core = relationshipCore(record);
  const endpoints = parseOptionalJsonObject(core.endpoints);
  return readOptionalString(record, 'type')
    ?? readOptionalString(endpoints, 'type')
    ?? readOptionalString(record, 'relationType')
    ?? readOptionalString(record, 'kind');
}

const CAREER_RELATIONSHIP_TYPES = new Set(['entry', 'postedToOffice']);
const WORK_RELATIONSHIP_TYPES = new Set(['text', 'authoredText']);

type CareerMilestoneCandidate = SourceDetailWorldCharacterMilestone & {
  mergeKey: string;
};

function isCareerRelationshipType(type: string | null): type is string {
  return Boolean(type && CAREER_RELATIONSHIP_TYPES.has(type));
}

function isWorkRelationshipType(type: string | null): type is string {
  return Boolean(type && WORK_RELATIONSHIP_TYPES.has(type));
}

function careerMilestoneKind(type: string): SourceDetailWorldCharacterMilestone['kind'] {
  if (type === 'postedToOffice') {
    return 'office';
  }
  return 'entry';
}

function readRelationshipSummary(record: JsonObject): string | null {
  const presentation = relationshipPresentation(record);
  return readOptionalString(presentation, 'summary')
    ?? readOptionalString(record, 'summary');
}

function readRelationshipId(record: JsonObject, fallback: string): string {
  return readOptionalString(record, 'id')
    ?? readOptionalString(record, 'relationshipId')
    ?? readOptionalString(record, 'contentHash')
    ?? fallback;
}

export function readRelationshipRows(value: unknown): JsonObject[] {
  return readRecordArray(value);
}

function readWorkTitleFromText(value: string | null): string | null {
  const text = value?.trim();
  if (!text) {
    return null;
  }
  const match = text.match(/《([^》]+)》/u)
    ?? text.match(/[「『]([^」』]+)[」』]/u);
  return match?.[1]?.trim() || null;
}

function readOfficeTitleFromSummary(summary: string | null): string | null {
  const match = summary?.match(/官至([^，。；、\s]+)/u)
    ?? summary?.match(/[任拜授为]([^，。；、\s]+(?:尚书|侍郎|学士|御史|知府|知州|知县|郎中|主事))/u);
  return match?.[1]?.trim() || null;
}

function normalizedCareerMergeText(value: string | null | undefined): string {
  return simplifySourceDetailChineseText(String(value || ''))
    .trim()
    .toLocaleLowerCase()
    .replace(/[《》「」『』（）()[\]\s,，。;；:：、·・\-_/]+/gu, '');
}

function readRelationshipTargetEntityId(row: JsonObject): string | null {
  const core = relationshipCore(row);
  return readScalarString(row.targetEntityId)
    ?? readScalarString(core.targetEntityId);
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
    summary,
    timeLabel: readMilestoneTimeLabel([attributes, presentation, core, row], [title, summary]),
  };
}

function normalizedWorkMergeText(value: string | null | undefined): string {
  return simplifySourceDetailChineseText(String(value || ''))
    .trim()
    .toLocaleLowerCase()
    .replace(/[《》「」『』（）()[\]\s,，。;；:：、·・\-_/]+/gu, '');
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
    || normalizedSummary.endsWith(`与著作${normalizedTitle}有关`)
    || normalizedSummary.endsWith(`与作品${normalizedTitle}有关`);
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
    status: display.status,
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

function isWorkLikeBiographyMilestone(
  row: JsonObject,
  title: string | null,
  summary: string | null,
): boolean {
  const explicitKind = readOptionalString(row, 'kind')?.toLocaleLowerCase();
  if (explicitKind === 'work' || explicitKind === 'text') {
    return true;
  }
  const text = [title, summary]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean)
    .join('\n');
  return /《[^》]+》/u.test(text)
    || /著作|著述|著有|撰有|作品|诗集|詩集|文集|词集|詞集|全集|\btext\b|\bwork\b|\bwriting\b|\bauthored\b/iu.test(text);
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
  const textId = readScalarString(row.textId) ?? readScalarString(row.textCode);
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
    summary,
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

function readRelationshipLabel(row: JsonObject): string | null {
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

function readRelationshipTargetLabel(row: JsonObject): string | null {
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

function milestoneTexts(milestone: SourceDetailWorldCharacterMilestone): string[] {
  return [milestone.title, milestone.summary]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean);
}

function milestoneTitlesOverlap(
  left: SourceDetailWorldCharacterMilestone,
  right: SourceDetailWorldCharacterMilestone,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  return milestoneTexts(left).some((leftText) => (
    milestoneTexts(right).some((rightText) => (
      leftText.includes(right.title)
        || rightText.includes(left.title)
        || leftText.includes(rightText)
        || rightText.includes(leftText)
    ))
  ));
}

function mergeDistinctText(left: string | null, right: string | null): string | null {
  const values: string[] = [];
  for (const value of [left, right]) {
    const normalized = value?.trim();
    if (!normalized) {
      continue;
    }
    const existingIndex = values.findIndex((candidate) => (
      candidate.includes(normalized) || normalized.includes(candidate)
    ));
    if (existingIndex >= 0) {
      if (normalized.length > values[existingIndex]!.length) {
        values[existingIndex] = normalized;
      }
      continue;
    }
    values.push(normalized);
  }
  return values.length > 0 ? values.join(' ') : null;
}

function readYearsFromLabel(value: string | null | undefined): number[] {
  return [...String(value || '').matchAll(/\d{3,4}/gu)]
    .map((match) => Number(match[0]))
    .filter((year) => Number.isFinite(year));
}

function mergeTimeLabel(left: string | null, right: string | null): string | null {
  const normalizedLeft = left?.trim() || null;
  const normalizedRight = right?.trim() || null;
  if (!normalizedLeft) {
    return normalizedRight;
  }
  if (!normalizedRight || normalizedLeft === normalizedRight) {
    return normalizedLeft;
  }
  const years = [...readYearsFromLabel(normalizedLeft), ...readYearsFromLabel(normalizedRight)];
  if (years.length > 0) {
    const min = Math.min(...years);
    const max = Math.max(...years);
    return min === max ? String(min) : `${min}-${max}`;
  }
  return mergeDistinctText(normalizedLeft, normalizedRight);
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

function readWorldCharacterMilestones(
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

function readWorldCharacterRelationshipNotes(sourceCore: JsonObject | null | undefined): SourceDetailWorldCharacterRelationshipNote[] {
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

function readWorldCharacterInteraction(sourceCore: JsonObject | null | undefined): SourceDetailWorldCharacterInteraction | null {
  const interaction = parseOptionalJsonObject(sourceCore?.interactionProfile)
    ?? parseOptionalJsonObject(sourceCore?.interaction);
  if (!interaction) {
    return null;
  }
  const profile = {
    tone: readOptionalString(interaction, 'tone'),
    cadence: readOptionalString(interaction, 'cadence'),
    scenario: readOptionalString(interaction, 'scenario'),
    greeting: readOptionalString(interaction, 'greeting'),
  };
  return Object.values(profile).some(Boolean) ? profile : null;
}

function appendUnique(target: string[], values: readonly string[]) {
  for (const value of values) {
    const normalized = value.trim();
    if (normalized && !target.includes(normalized)) {
      target.push(normalized);
    }
  }
}

function readWorldCharacterConversationAnchors(sourceCore: JsonObject | null | undefined): string[] {
  const interaction = parseOptionalJsonObject(sourceCore?.interactionProfile)
    ?? parseOptionalJsonObject(sourceCore?.interaction);
  const knowledge = parseOptionalJsonObject(sourceCore?.knowledge);
  const anchors: string[] = [];
  appendUnique(anchors, readStringArray(interaction?.greetingVariants));
  appendUnique(anchors, readStringArray(interaction?.dialogueExemplars));
  appendUnique(anchors, readStringArray(knowledge?.topics).filter((topic) => topic.length <= 72));
  appendUnique(anchors, readStringArray(knowledge?.constraints));
  return anchors.slice(0, 10);
}

export function readWorldCharacter(
  sourceCore: JsonObject | null | undefined,
  careerMilestones: readonly SourceDetailWorldCharacterMilestone[],
): SourceDetailWorldCharacter | null {
  if (!sourceCore) {
    return null;
  }
  const placement = parseOptionalJsonObject(sourceCore.placement);
  const worldCharacter: SourceDetailWorldCharacter = {
    role: readOptionalString(placement, 'role'),
    faction: readOptionalString(placement, 'faction'),
    rank: readOptionalString(placement, 'rank'),
    sceneRefs: readStringArray(placement?.sceneRefs),
    milestones: readWorldCharacterMilestones(sourceCore, careerMilestones),
    relationshipNotes: readWorldCharacterRelationshipNotes(sourceCore),
    conversationAnchors: readWorldCharacterConversationAnchors(sourceCore),
    interaction: readWorldCharacterInteraction(sourceCore),
  };
  const hasData = Boolean(
    worldCharacter.role
      || worldCharacter.faction
      || worldCharacter.rank
      || worldCharacter.sceneRefs.length
      || worldCharacter.milestones.length
      || worldCharacter.relationshipNotes.length
      || worldCharacter.conversationAnchors.length
      || worldCharacter.interaction,
  );
  return hasData ? worldCharacter : null;
}

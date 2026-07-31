import type { JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { SourceDetailWorldCharacterMilestone } from './source-detail-model.js';
import {
  readMilestoneTimeLabel,
  readOptionalString,
  readScalarString,
  readTimeLabelFromText,
  readYearLabel,
} from './source-detail-model-readers.js';
import {
  mergeDistinctText,
  mergeTimeLabel,
  milestoneTexts,
  milestoneTitlesOverlap,
  normalizedCareerMergeText,
} from './source-detail-world-character-common.js';
import { simplifySourceDetailChineseText } from './source-detail-simplified-chinese.js';
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

type CareerOfficeTermPart = {
  prefix: string;
  tail: string;
};

const OFFICE_TITLE_TAILS = [
  '翰林学士承旨',
  '学士承旨',
  '大司农丞',
  '司农丞',
  '直学士',
  '大学士',
  '学士',
  '尚书',
  '侍郎',
  '御史',
  '知府',
  '知州',
  '知县',
  '郎中',
  '主事',
  '山长',
  '院长',
  '祭酒',
  '司业',
  '承旨',
  '丞',
].map(normalizedCareerMergeText).sort((left, right) => right.length - left.length);

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

function normalizeOfficeTail(tail: string): string {
  if (tail === normalizedCareerMergeText('大司农丞')) {
    return normalizedCareerMergeText('司农丞');
  }
  return tail;
}

function readCareerOfficeTermPart(term: string): CareerOfficeTermPart | null {
  const normalized = normalizedCareerMergeText(term);
  if (!normalized) {
    return null;
  }
  for (const tail of OFFICE_TITLE_TAILS) {
    if (normalized.endsWith(tail) && normalized.length > tail.length) {
      return {
        prefix: normalized.slice(0, -tail.length),
        tail: normalizeOfficeTail(tail),
      };
    }
  }
  return null;
}

function stripCareerPhraseNoise(value: string): string {
  return simplifySourceDetailChineseText(value)
    .replace(/^[\d〇零一二三四五六七八九十百千元明清唐宋辽金西夏年月日（）()\s-]+/u, '')
    .replace(/^(?:[^，。；;：:]{1,8})?(?:曾任或关联官职|曾任|历任|官至|出任|任职于|任|拜|授为|授|为)\s*[:：]?\s*/u, '')
    .replace(/(?:一职|有关|这是.+|是其.+|，.+)$/u, '')
    .trim();
}

function readCareerOfficePhrases(value: string): string[] {
  const simplified = simplifySourceDetailChineseText(value).trim();
  if (!simplified) {
    return [];
  }
  const phrases: string[] = [];
  for (const clause of simplified.split(/[。；;]/u)) {
    const normalizedClause = clause.trim();
    if (!normalizedClause) {
      continue;
    }
    const colonTail = /(?:曾任或关联官职|曾任|历任|官至|出任|任职于|任|拜|授为|授|为)\s*[:：]\s*([^。；;]+)/u.exec(normalizedClause)?.[1];
    if (colonTail?.trim()) {
      phrases.push(stripCareerPhraseNoise(colonTail));
      continue;
    }
    const actionTail = /(?:曾任或关联官职|曾任|历任|官至|出任|任职于|任|拜|授为|授|为)\s*([^，。；;]+)/u.exec(normalizedClause)?.[1];
    if (actionTail?.trim()) {
      phrases.push(stripCareerPhraseNoise(actionTail));
      continue;
    }
    const officeLike = /(翰林|国史院|司农|尚书|侍郎|御史|知府|知州|知县|郎中|主事|山长|院长|祭酒|司业|承旨|学士|丞)/u.test(normalizedClause);
    if (officeLike) {
      phrases.push(stripCareerPhraseNoise(normalizedClause));
    }
  }
  return phrases.filter(Boolean);
}

function readSharedOfficePrefix(term: string): string | null {
  const part = readCareerOfficeTermPart(term);
  if (!part?.prefix || part.prefix.length < 2) {
    return null;
  }
  return part.prefix;
}

function expandCareerOfficePhrase(phrase: string): string[] {
  const terms = new Set<string>();
  const rawParts = phrase
    .split(/(?:以及|、|\/|／|及|和|与)/u)
    .map((part) => stripCareerPhraseNoise(part))
    .filter(Boolean);
  let sharedPrefix: string | null = null;
  for (const rawPart of rawParts) {
    const normalized = normalizedCareerMergeText(rawPart);
    if (!normalized) {
      continue;
    }
    terms.add(normalized);
    const partPrefix = readSharedOfficePrefix(normalized);
    if (partPrefix) {
      sharedPrefix = partPrefix;
      continue;
    }
    if (sharedPrefix && normalized.length <= 6) {
      terms.add(`${sharedPrefix}${normalized}`);
      if (normalized === normalizedCareerMergeText('承旨')) {
        terms.add(`${sharedPrefix}${normalizedCareerMergeText('学士承旨')}`);
      }
    }
  }
  if (rawParts.length === 0) {
    const normalized = normalizedCareerMergeText(phrase);
    if (normalized) {
      terms.add(normalized);
    }
  }
  return [...terms];
}

function careerOfficeTerms(milestone: SourceDetailWorldCharacterMilestone): string[] {
  const terms = new Set<string>();
  for (const text of milestoneTexts(milestone)) {
    for (const phrase of readCareerOfficePhrases(text)) {
      for (const term of expandCareerOfficePhrase(phrase)) {
        terms.add(term);
      }
    }
  }
  return [...terms];
}

function careerOfficeTermParts(milestone: SourceDetailWorldCharacterMilestone): CareerOfficeTermPart[] {
  return careerOfficeTerms(milestone)
    .map(readCareerOfficeTermPart)
    .filter((part): part is CareerOfficeTermPart => Boolean(part));
}

function careerOfficePrefixesOverlap(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  return left.includes(right) || right.includes(left);
}

function careerOfficeFactsOverlap(
  left: SourceDetailWorldCharacterMilestone,
  right: SourceDetailWorldCharacterMilestone,
): boolean {
  const leftTerms = careerOfficeTerms(left);
  const rightTerms = careerOfficeTerms(right);
  if (leftTerms.some((leftTerm) => rightTerms.includes(leftTerm))) {
    return true;
  }
  const leftParts = careerOfficeTermParts(left);
  const rightParts = careerOfficeTermParts(right);
  return leftParts.some((leftPart) => rightParts.some((rightPart) => (
    leftPart.tail === rightPart.tail
      && careerOfficePrefixesOverlap(leftPart.prefix, rightPart.prefix)
  )));
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
        || careerOfficeFactsOverlap(candidate, milestone)
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
        || careerOfficeFactsOverlap(candidate, milestone)
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
  )) || careerOfficeFactsOverlap(authored, career);
}

export function composeWorldCharacterMilestones(
  sharedMilestones: readonly SourceDetailWorldCharacterMilestone[],
  careerMilestones: readonly SourceDetailWorldCharacterMilestone[],
): SourceDetailWorldCharacterMilestone[] {
  const authored = [...sharedMilestones]
    .sort((left, right) => (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER));
  const mergedAuthored = authored.map((milestone) => {
    const matchingCareers = careerMilestones.filter((candidate) => careerMilestoneMatchesAuthored(milestone, candidate));
    if (matchingCareers.length === 0) {
      return milestone;
    }
    return matchingCareers.reduce((merged, career) => ({
      ...merged,
      summary: mergeDistinctText(merged.summary, career.summary),
      timeLabel: mergeTimeLabel(merged.timeLabel, career.timeLabel),
      kind: merged.kind === 'biography' && career.kind !== 'biography' ? career.kind : merged.kind,
      derived: true,
    }), milestone);
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

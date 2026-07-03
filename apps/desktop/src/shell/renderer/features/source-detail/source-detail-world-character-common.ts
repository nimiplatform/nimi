import type { JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type {
  SourceDetailWorkCollection,
  SourceDetailWorldCharacterMilestone,
} from './source-detail-model.js';
import {
  readOptionalString,
  readScalarString,
} from './source-detail-model-readers.js';
import { simplifySourceDetailChineseText } from './source-detail-simplified-chinese.js';

export function normalizeWorkStatus(value: unknown): SourceDetailWorkCollection['status'] {
  const status = readScalarString(value)?.toLocaleLowerCase();
  if (status === 'resolved' || status === 'unresolved') {
    return status;
  }
  return 'unknown';
}

export function readWorkTitle(row: JsonObject): string | null {
  return readOptionalString(row, 'titleChn')
    ?? readOptionalString(row, 'titleZh')
    ?? readOptionalString(row, 'chineseTitle')
    ?? readOptionalString(row, 'displayTitle')
    ?? readOptionalString(row, 'name')
    ?? readOptionalString(row, 'title');
}

export function readWorkTitleFromText(value: string | null): string | null {
  const text = value?.trim();
  if (!text) {
    return null;
  }
  const match = text.match(/《([^》]+)》/u)
    ?? text.match(/[「『]([^」』]+)[」』]/u);
  return match?.[1]?.trim() || null;
}

export function normalizedCareerMergeText(value: string | null | undefined): string {
  return simplifySourceDetailChineseText(String(value || ''))
    .trim()
    .toLocaleLowerCase()
    .replace(/[《》「」『』（）()[\]\s,，。;；:：、·・\-_/]+/gu, '');
}

export function normalizedWorkMergeText(value: string | null | undefined): string {
  return simplifySourceDetailChineseText(String(value || ''))
    .trim()
    .toLocaleLowerCase()
    .replace(/[《》「」『』（）()[\]\s,，。;；:：、·・\-_/]+/gu, '');
}

export function isWorkLikeBiographyMilestone(
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

export function milestoneTexts(milestone: SourceDetailWorldCharacterMilestone): string[] {
  return [milestone.title, milestone.summary]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean);
}

export function milestoneTitlesOverlap(
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

export function mergeDistinctText(left: string | null, right: string | null): string | null {
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

export function mergeTimeLabel(left: string | null, right: string | null): string | null {
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

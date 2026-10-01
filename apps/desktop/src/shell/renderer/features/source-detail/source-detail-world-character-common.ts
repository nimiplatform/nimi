import type { JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { SourceDetailWorkCollection } from './source-detail-model.js';
import {
  readOptionalString,
  readScalarString,
} from './source-detail-model-readers.js';

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

// Equality key for two explicit values that name the same thing. It only
// ignores case, whitespace, and punctuation; it never converts scripts, so
// authored text in any language compares as written.
export function normalizedMergeText(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

// Joins the explicit texts of records that were merged by explicit identity.
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
  return [...String(value || '').matchAll(/(?<!\d)\d{3,4}(?!\d)/gu)]
    .map((match) => Number(match[0]))
    .filter((year) => Number.isFinite(year));
}

// Combines two explicit time labels of the same merged record.
export function mergeTimeLabel(left: string | null, right: string | null): string | null {
  const normalizedLeft = left?.trim() || null;
  const normalizedRight = right?.trim() || null;
  if (!normalizedLeft) {
    return normalizedRight;
  }
  if (!normalizedRight || normalizedLeft === normalizedRight) {
    return normalizedLeft;
  }
  const leftYears = readYearsFromLabel(normalizedLeft);
  const rightYears = readYearsFromLabel(normalizedRight);
  if (leftYears.length > 0 && rightYears.length > 0) {
    const years = [...leftYears, ...rightYears];
    const min = Math.min(...years);
    const max = Math.max(...years);
    return min === max ? String(min) : `${min}-${max}`;
  }
  return mergeDistinctText(normalizedLeft, normalizedRight);
}

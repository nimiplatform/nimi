/**
 * classification.ts — Content classification utilities
 */

import { parse } from 'yaml';
import contentClassificationYaml from '../../../../spec/kernel/tables/content-classification.yaml?raw';

export type ContentType = 'history' | 'literature' | 'mythology';
export type TruthMode = 'factual' | 'dramatized' | 'legendary';

export type ClassificationPair = {
  contentType: ContentType;
  truthMode: TruthMode;
  badge: string;        // Student-facing combined label e.g. "历史 / 史实"
  contentLabel: string; // e.g. "历史"
  truthLabel: string;   // e.g. "史实"
};

type ClassificationAuthorityTable = {
  content_types?: unknown;
  truth_modes?: unknown;
  allowed_pairs?: unknown;
};

type LabelRow = {
  key?: unknown;
  display_label?: unknown;
};

type AllowedPairRow = {
  contentType?: unknown;
  truthMode?: unknown;
  ui_badge?: unknown;
};

function rows(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Invalid ShiJi content classification authority: ${field} must be a non-empty list`);
  }
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid ShiJi content classification authority: ${field} must be a non-empty string`);
  }
  return value.trim();
}

function labelMap(value: unknown, field: string): Map<string, string> {
  const labels = new Map<string, string>();

  for (const entry of rows(value, field)) {
    const row = entry as LabelRow;
    const key = nonEmptyString(row.key, `${field}.key`);
    const label = nonEmptyString(row.display_label, `${field}.${key}.display_label`);

    if (labels.has(key)) {
      throw new Error(`Invalid ShiJi content classification authority: duplicate ${field} key ${key}`);
    }

    labels.set(key, label);
  }

  return labels;
}

export function buildClassificationPairsFromAuthority(rawAuthority: string): readonly ClassificationPair[] {
  const table = parse(rawAuthority) as ClassificationAuthorityTable | null;

  if (!table || typeof table !== 'object') {
    throw new Error('Invalid ShiJi content classification authority: table must be an object');
  }

  const contentLabels = labelMap(table.content_types, 'content_types');
  const truthLabels = labelMap(table.truth_modes, 'truth_modes');
  const seenPairs = new Set<string>();

  return Object.freeze(rows(table.allowed_pairs, 'allowed_pairs').map((entry) => {
    const row = entry as AllowedPairRow;
    const contentType = nonEmptyString(row.contentType, 'allowed_pairs.contentType') as ContentType;
    const truthMode = nonEmptyString(row.truthMode, 'allowed_pairs.truthMode') as TruthMode;
    const badge = nonEmptyString(row.ui_badge, `allowed_pairs.${contentType}.${truthMode}.ui_badge`);
    const contentLabel = contentLabels.get(contentType);
    const truthLabel = truthLabels.get(truthMode);
    const pairKey = `${contentType}:${truthMode}`;

    if (!contentLabel) {
      throw new Error(`Invalid ShiJi content classification authority: missing content label for ${contentType}`);
    }
    if (!truthLabel) {
      throw new Error(`Invalid ShiJi content classification authority: missing truth label for ${truthMode}`);
    }
    if (seenPairs.has(pairKey)) {
      throw new Error(`Invalid ShiJi content classification authority: duplicate allowed pair ${pairKey}`);
    }

    seenPairs.add(pairKey);

    return {
      contentType,
      truthMode,
      badge,
      contentLabel,
      truthLabel,
    };
  }));
}

export const CLASSIFICATION_PAIRS = buildClassificationPairsFromAuthority(contentClassificationYaml);

export function getClassification(contentType: string, truthMode: string): ClassificationPair | null {
  return CLASSIFICATION_PAIRS.find(
    (p) => p.contentType === contentType && p.truthMode === truthMode,
  ) ?? null;
}

export function isValidPair(contentType: string, truthMode: string): boolean {
  return getClassification(contentType, truthMode) !== null;
}

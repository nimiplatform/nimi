/**
 * classification.ts — Content classification utilities
 * Runtime representation of spec/kernel/tables/content-classification.yaml
 */

export type ContentType = 'history' | 'literature' | 'mythology';
export type TruthMode = 'factual' | 'dramatized' | 'legendary';

export type ClassificationPair = {
  contentType: ContentType;
  truthMode: TruthMode;
  badge: string;        // Student-facing combined label e.g. "历史 / 史实"
  contentLabel: string; // e.g. "历史"
  truthLabel: string;   // e.g. "史实"
};

export const CLASSIFICATION_PAIRS: ClassificationPair[] = [
  { contentType: 'history',    truthMode: 'factual',    badge: '历史 / 史实', contentLabel: '历史', truthLabel: '史实' },
  { contentType: 'literature', truthMode: 'dramatized', badge: '名著 / 演义', contentLabel: '名著', truthLabel: '演义' },
  { contentType: 'mythology',  truthMode: 'legendary',  badge: '神话 / 传说', contentLabel: '神话', truthLabel: '传说' },
];

export function getClassification(contentType: string, truthMode: string): ClassificationPair | null {
  return CLASSIFICATION_PAIRS.find(
    (p) => p.contentType === contentType && p.truthMode === truthMode,
  ) ?? null;
}

export function isValidPair(contentType: string, truthMode: string): boolean {
  return getClassification(contentType, truthMode) !== null;
}

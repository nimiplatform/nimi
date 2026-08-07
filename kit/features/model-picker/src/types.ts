import type { ReactNode } from 'react';

export type ModelPickerDetailRow = {
  readonly label: string;
  readonly value: string;
};

export type ModelPickerBadgeTone = 'neutral' | 'accent' | 'success' | 'warning';

export type ModelPickerBadge = {
  readonly label: string;
  readonly tone?: ModelPickerBadgeTone;
};

export type ModelPickerGroup<TCandidate> = {
  readonly key: string;
  readonly label: string;
  readonly candidates: readonly TCandidate[];
};

/** Owner-supplied candidate projection. It has no mutation or Runtime seam. */
export interface ModelPickerCandidateAdapter<TCandidate> {
  listCandidates(): Promise<readonly TCandidate[]> | readonly TCandidate[];
  getId(candidate: TCandidate): string;
  getTitle(candidate: TCandidate): string;
  getDescription?(candidate: TCandidate): string | undefined;
  getCapabilities?(candidate: TCandidate): readonly string[];
  getBadges?(candidate: TCandidate): readonly ModelPickerBadge[];
  getSource?(candidate: TCandidate): string | undefined;
  getDetailRows?(candidate: TCandidate): readonly ModelPickerDetailRow[];
  getGroupKey?(candidate: TCandidate): string | undefined;
  getGroupLabel?(groupKey: string, candidates: readonly TCandidate[]): string;
  getSearchText?(candidate: TCandidate): string | undefined;
}

export type ModelPickerCopy = Partial<{
  readonly searchPlaceholder: string;
  readonly capabilityFilterLabel: string;
  readonly sourceFilterLabel: string;
  readonly allLabel: string;
  readonly loadingLabel: ReactNode;
  readonly emptyLabel: ReactNode;
  readonly retryLabel: string;
  readonly detailEmptyLabel: string;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
}>;

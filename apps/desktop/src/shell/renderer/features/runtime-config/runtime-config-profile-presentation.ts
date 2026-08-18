import type { RuntimeConfigAIProfileTransferPlan } from './runtime-config-ai-profile-transfer.js';

export type RuntimeConfigProfileDownloadSummary = {
  readonly kind: 'none' | 'known' | 'unknown';
  readonly count: number;
  readonly totalBytes: number | null;
};

export function summarizeRuntimeConfigProfileDownloads(
  plan: Pick<RuntimeConfigAIProfileTransferPlan, 'downloads' | 'totalDownloadBytes'>,
): RuntimeConfigProfileDownloadSummary {
  const count = plan.downloads.length;
  if (count === 0) return Object.freeze({ kind: 'none', count: 0, totalBytes: 0 });
  if (plan.totalDownloadBytes === null) {
    return Object.freeze({ kind: 'unknown', count, totalBytes: null });
  }
  return Object.freeze({ kind: 'known', count, totalBytes: plan.totalDownloadBytes });
}

export function selectRuntimeConfigProfileExportLoadout(input: {
  readonly currentIds: readonly string[];
  readonly loadoutId: string;
  readonly sameUseIds: ReadonlySet<string>;
  readonly checked: boolean;
}): readonly string[] {
  if (!input.checked) return input.currentIds.filter((id) => id !== input.loadoutId);
  return Object.freeze([
    ...input.currentIds.filter((id) => !input.sameUseIds.has(id)),
    input.loadoutId,
  ]);
}

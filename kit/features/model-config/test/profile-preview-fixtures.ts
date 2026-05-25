// Shared fixtures for model-config profile apply tests.
//
// D-AIPC-014 / S-AICONF-008: the apply flow is preview-gated. These helpers
// keep the preview-step `ModelConfigProfileCopy` strings and the
// `aiProfile.previewApply` stub in one place so the individual test files do
// not each re-declare them.

import type {
  AIConfig,
  AIProfile,
  AIProfilePreviewResult,
  AIScopeRef,
} from '@nimiplatform/sdk/ai';
import type { ModelConfigProfileCopy } from '../src/types.js';

/** The D-AIPC-014 preview-step subset of ModelConfigProfileCopy. */
export const previewCopyFields: Pick<
  ModelConfigProfileCopy,
  | 'previewTitle'
  | 'previewHint'
  | 'previewingLabel'
  | 'previewFirstApplyLabel'
  | 'previewNoChangeLabel'
  | 'previewBeforeLabel'
  | 'previewAfterLabel'
  | 'previewWarningsLabel'
  | 'previewConfirmLabel'
  | 'previewBackLabel'
> = {
  previewTitle: 'Review changes',
  previewHint: 'Review the before and after configuration.',
  previewingLabel: 'Computing preview...',
  previewFirstApplyLabel: 'This scope has no AI configuration yet.',
  previewNoChangeLabel: 'This profile matches the current configuration.',
  previewBeforeLabel: 'Current',
  previewAfterLabel: 'After apply',
  previewWarningsLabel: 'Warnings',
  previewConfirmLabel: 'Confirm & Apply',
  previewBackLabel: 'Back',
};

/**
 * A non-committing `previewApply` stub that materializes the would-be `after`
 * config and returns a typed preview result. Schema-invalid profiles fail
 * closed (throw), matching the host contract.
 */
export function makePreviewApplyStub(input: {
  readonly currentConfig: () => AIConfig;
  readonly profilesById: ReadonlyArray<AIProfile>;
}): (scopeRef: AIScopeRef, profileId: string) => Promise<AIProfilePreviewResult> {
  return async (_scopeRef, profileId) => {
    const profile = input.profilesById.find((entry) => entry.profileId === profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }
    const before = input.currentConfig();
    const after: AIConfig = {
      ...before,
      profileOrigin: { profileId: profile.profileId, title: profile.title, appliedAt: 'preview' },
    };
    return {
      before,
      after,
      diff: {
        identical: false,
        fields: [
          {
            path: 'profileOrigin.profileId',
            changeKind: 'changed',
            before: before.profileOrigin?.profileId ?? null,
            after: profile.profileId,
          },
        ],
      },
      baseVersion: 'base-v1',
      probeWarnings: [],
    };
  };
}

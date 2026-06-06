// kit/core/model-config profile controller core.
//
// Pure-logic strategy for resolving an NimiAIProfile apply attempt into one of
// three canonical apply paths per D-AIPC-005 atomic overwrite semantics:
//
//   - remote-success
//   - remote-fail-without-user-profile
//   - network-error
//
// The React hook in kit/features wraps this core with react-query and state;
// this file must never import React.

import type {
  NimiAIConfig,
  NimiAIProfileApplyResult,
  NimiAIProfilePreviewResult,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  ModelConfigDiffRow,
  ModelConfigPreviewState,
  ModelConfigProfileApplyPath,
  ModelConfigProfileControllerCoreInput,
  UserProfilesSource,
} from './types.js';

export interface ModelConfigProfileControllerCore {
  readonly scopeRef: ModelConfigProfileControllerCoreInput['scopeRef'];
  /**
   * Resolve a remote apply result into an atomic apply path.
   * Never produces placeholder success: if the remote path failed, this returns
   * remote-fail-without-user-profile and the controller must surface the
   * failure reason to consumers.
   */
  resolveRemoteApply(input: {
    readonly profileId: string;
    readonly remoteResult: NimiAIProfileApplyResult;
    readonly currentConfig: NimiAIConfig;
    readonly now: () => string;
  }): ModelConfigProfileApplyPath;
  /**
   * Resolve an exception thrown by the remote apply call into a network-error
   * apply path. Does not rescue typed failures; those must reach
   * resolveRemoteApply via NimiAIProfileApplyResult.
   */
  resolveNetworkError(input: {
    readonly profileId: string;
    readonly error: unknown;
  }): ModelConfigProfileApplyPath;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  return 'Profile apply failed.';
}

function diffValueToText(value: unknown): string {
  if (value === undefined || value === null) {
    return '—';
  }
  if (typeof value === 'string') {
    return value || '""';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Project an `NimiAIProfilePreviewResult` (D-AIPC-014 / S-AICONF-008) into a
 * displayable preview state for the preview→confirm step.
 *
 * Pure logic: it only reshapes the typed diff; it never commits, mutates, or
 * persists. The full preview result is retained so the caller can commit via
 * `aiProfile.apply` after explicit user confirmation.
 */
export function summarizeProfilePreview(input: {
  readonly profileId: string;
  readonly preview: NimiAIProfilePreviewResult;
}): ModelConfigPreviewState {
  const { profileId, preview } = input;
  const rows: ModelConfigDiffRow[] = preview.diff.fields.map((field) => ({
    path: field.path,
    changeKind: field.changeKind,
    beforeText: diffValueToText(field.before),
    afterText: diffValueToText(field.after),
  }));
  return {
    profileId,
    isFirstApply: preview.before === null,
    identical: preview.diff.identical,
    rows,
    baseVersion: preview.baseVersion,
    probeWarnings: preview.probeWarnings,
    preview,
  };
}

/**
 * D-AIPC-005 atomic apply path selector.
 *
 * Rules:
 *   - success           -> remote-success; use the host-resolved NimiAIConfig.
 *   - remote fail       -> remote-fail-without-user-profile with failureReason.
 *   - exception thrown  -> resolveNetworkError returns network-error.
 *
 * Never returns a placeholder success on failure.
 */
export function createModelConfigProfileControllerCore(
  input: ModelConfigProfileControllerCoreInput,
): ModelConfigProfileControllerCore {
  return {
    scopeRef: input.scopeRef,
    resolveRemoteApply(args): ModelConfigProfileApplyPath {
      const { remoteResult } = args;
      if (remoteResult.success && remoteResult.config) {
        return {
          kind: 'remote-success',
          nextConfig: remoteResult.config,
          profileOrigin: remoteResult.config.profileOrigin ?? null,
        };
      }
      return {
        kind: 'remote-fail-without-user-profile',
        failureReason: remoteResult.failureReason || 'Profile apply failed.',
      };
    },
    resolveNetworkError({ error }): ModelConfigProfileApplyPath {
      return {
        kind: 'network-error',
        failureReason: describeError(error),
      };
    },
  };
}

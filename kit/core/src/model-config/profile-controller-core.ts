// kit/core/model-config profile controller core.
//
// Pure-logic strategy for resolving an AIProfile apply attempt into one of
// four canonical apply paths per D-AIPC-005 atomic overwrite semantics:
//
//   - remote-success
//   - remote-fail-with-user-profile  (local fallback via applyAIProfileToConfig)
//   - remote-fail-without-user-profile
//   - network-error
//
// The React hook in kit/features wraps this core with react-query and state;
// this file must never import React.

import type {
  AIConfig,
  AIProfile,
  AIProfileApplyResult,
  AIProfileRef,
} from '@nimiplatform/sdk/mod';
import type {
  ModelConfigProfileApplyPath,
  ModelConfigProfileControllerCoreInput,
  UserProfilesSource,
} from './types.js';

export interface ModelConfigProfileControllerCore {
  readonly scopeRef: ModelConfigProfileControllerCoreInput['scopeRef'];
  readonly userProfilesSource: UserProfilesSource | null;
  /**
   * Resolve a remote apply result into an atomic apply path.
   * Never produces placeholder success: if the remote path failed and no
   * matching user profile exists, this returns remote-fail-without-user-profile
   * and the controller must surface the failure reason to consumers.
   */
  resolveRemoteApply(input: {
    readonly profileId: string;
    readonly remoteResult: AIProfileApplyResult;
    readonly currentConfig: AIConfig;
    readonly applyAIProfileToConfig: (config: AIConfig, profile: AIProfile) => AIConfig;
    readonly now: () => string;
  }): ModelConfigProfileApplyPath;
  /**
   * Resolve an exception thrown by the remote apply call into a network-error
   * apply path. Does not rescue typed failures; those must reach
   * resolveRemoteApply via AIProfileApplyResult.
   */
  resolveNetworkError(input: {
    readonly profileId: string;
    readonly error: unknown;
  }): ModelConfigProfileApplyPath;
}

function findUserProfile(source: UserProfilesSource | null, profileId: string): AIProfile | null {
  if (!source) {
    return null;
  }
  for (const profile of source.list()) {
    if (profile.profileId === profileId) {
      return profile;
    }
  }
  return null;
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

function buildProfileOrigin(profile: AIProfile, now: () => string): AIProfileRef {
  return {
    profileId: profile.profileId,
    title: profile.title || profile.profileId,
    appliedAt: now(),
  };
}

/**
 * D-AIPC-005 atomic apply path selector.
 *
 * Rules:
 *   - success           -> remote-success; use the host-resolved AIConfig.
 *   - remote fail       -> if userProfilesSource admits the profile, apply
 *                          applyAIProfileToConfig to currentConfig and return
 *                          remote-fail-with-user-profile. Otherwise return
 *                          remote-fail-without-user-profile with failureReason.
 *   - exception thrown  -> resolveNetworkError returns network-error.
 *
 * Never returns a placeholder success on failure.
 */
export function createModelConfigProfileControllerCore(
  input: ModelConfigProfileControllerCoreInput,
): ModelConfigProfileControllerCore {
  const userProfilesSource = input.userProfilesSource ?? null;

  return {
    scopeRef: input.scopeRef,
    userProfilesSource,
    resolveRemoteApply(args): ModelConfigProfileApplyPath {
      const { profileId, remoteResult, currentConfig, applyAIProfileToConfig, now } = args;
      if (remoteResult.success && remoteResult.config) {
        return {
          kind: 'remote-success',
          nextConfig: remoteResult.config,
          profileOrigin: remoteResult.config.profileOrigin ?? null,
        };
      }
      const userProfile = findUserProfile(userProfilesSource, profileId);
      if (!userProfile) {
        return {
          kind: 'remote-fail-without-user-profile',
          failureReason: remoteResult.failureReason || 'Profile apply failed.',
        };
      }
      const nextConfig = applyAIProfileToConfig(currentConfig, userProfile);
      return {
        kind: 'remote-fail-with-user-profile',
        nextConfig,
        profileOrigin: nextConfig.profileOrigin ?? buildProfileOrigin(userProfile, now),
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

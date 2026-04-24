import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AIConfig,
  AIProfile,
  AIProfileApplyResult,
  AIScopeRef,
} from '@nimiplatform/sdk/mod';
import {
  createModelConfigProfileControllerCore,
  type SharedAIConfigService,
  type UserProfilesSource,
} from '@nimiplatform/nimi-kit/core/model-config';
import type {
  ModelConfigProfileController,
  ModelConfigProfileCopy,
  ModelConfigProfileOption,
} from '../types.js';

/**
 * Host-injected applier bridging D-AIPC-005 AIProfile → AIConfig transition.
 * The canonical implementation lives in the host sdk (`applyAIProfileToConfig`);
 * kit/features must not import it directly to preserve the adapter boundary.
 */
export type ApplyAIProfileToConfigFn = (config: AIConfig, profile: AIProfile) => AIConfig;

export interface UseModelConfigProfileControllerInput {
  readonly scopeRef: AIScopeRef;
  readonly aiConfigService: SharedAIConfigService;
  readonly copy: ModelConfigProfileCopy;
  readonly applyAIProfileToConfig: ApplyAIProfileToConfigFn;
  readonly userProfilesSource?: UserProfilesSource;
  readonly currentOrigin: {
    profileId: string;
    title?: string | null;
  } | null;
  readonly onManage?: () => void;
}

function toProfileOptions(profiles: readonly AIProfile[]): ModelConfigProfileOption[] {
  return profiles.map((profile) => ({
    profileId: profile.profileId,
    title: profile.title || profile.profileId,
    description: profile.description || '',
  }));
}

/**
 * Default kit hook that composes SharedAIConfigService + optional user profile
 * fallback into a ModelConfigProfileController, enforcing D-AIPC-005 atomic
 * apply semantics across the four canonical paths:
 *   remote-success / remote-fail-with-user-profile /
 *   remote-fail-without-user-profile / network-error.
 *
 * The catalog fetch is a host-scoped Promise; we consume it with useEffect so
 * kit/features/model-config retains zero third-party data-fetching dependency
 * beyond what the wider kit ecosystem already ships.
 */
export function useModelConfigProfileController(
  input: UseModelConfigProfileControllerInput,
): ModelConfigProfileController {
  const {
    aiConfigService,
    scopeRef,
    userProfilesSource,
    copy,
    currentOrigin,
    onManage,
    applyAIProfileToConfig,
  } = input;
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ReadonlyArray<AIProfile>>([]);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const core = useMemo(
    () => createModelConfigProfileControllerCore({
      scopeRef,
      service: aiConfigService,
      userProfilesSource,
    }),
    [aiConfigService, scopeRef, userProfilesSource],
  );

  useEffect(() => {
    let cancelled = false;
    const isFirstLoad = reloadToken === 0;
    if (isFirstLoad) {
      setLoading(true);
    } else {
      setReloading(true);
    }
    (async () => {
      try {
        const remote = await aiConfigService.aiProfile.list();
        const userProfiles = userProfilesSource ? [...userProfilesSource.list()] : [];
        if (cancelled) return;
        setProfiles([...remote, ...userProfiles]);
        setLoadError(null);
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error || 'Failed to load profiles.'));
      } finally {
        if (cancelled) return;
        setLoading(false);
        setReloading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [aiConfigService, reloadToken, scopeRef, userProfilesSource]);

  const profileOptions = useMemo(() => toProfileOptions(profiles), [profiles]);

  const handleApply = useCallback((profileId: string) => {
    if (!profileId) return;
    setApplying(true);
    setApplyError(null);
    void aiConfigService.aiProfile.apply(scopeRef, profileId)
      .then((remoteResult: AIProfileApplyResult) => {
        const resolution = core.resolveRemoteApply({
          profileId,
          remoteResult,
          currentConfig: aiConfigService.aiConfig.get(scopeRef),
          applyAIProfileToConfig,
          now: () => new Date().toISOString(),
        });
        if (resolution.kind === 'remote-success') {
          aiConfigService.aiConfig.update(scopeRef, resolution.nextConfig);
          return;
        }
        if (resolution.kind === 'remote-fail-with-user-profile') {
          aiConfigService.aiConfig.update(scopeRef, resolution.nextConfig);
          return;
        }
        setApplyError(resolution.failureReason);
      })
      .catch((error: unknown) => {
        const resolution = core.resolveNetworkError({ profileId, error });
        setApplyError(resolution.kind === 'network-error' ? resolution.failureReason : 'Profile apply failed.');
      })
      .finally(() => {
        setApplying(false);
      });
  }, [aiConfigService, applyAIProfileToConfig, core, scopeRef]);

  return {
    currentOrigin,
    profiles: profileOptions,
    selectedProfileId,
    isLoading: loading,
    isReloading: reloading,
    error: applyError || loadError,
    applying,
    copy,
    onSelectedProfileChange: setSelectedProfileId,
    onApply: handleApply,
    onManage,
    onReload: () => {
      setReloadToken((prev) => prev + 1);
    },
  };
}

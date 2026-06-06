import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  NimiAIProfile,
  NimiAIProfileApplyResult,
  NimiAIProfilePreviewResult,
  NimiAIScopeRef,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  createModelConfigProfileControllerCore,
  summarizeProfilePreview,
  type SharedAIConfigService,
  type UserProfilesSource,
} from '@nimiplatform/kit/core/model-config';
import type {
  ModelConfigProfileController,
  ModelConfigProfileCopy,
  ModelConfigProfileOption,
  ModelConfigProfilePreview,
} from '../types.js';

export interface UseModelConfigProfileControllerInput {
  readonly scopeRef: NimiAIScopeRef;
  readonly aiConfigService: SharedAIConfigService;
  readonly copy: ModelConfigProfileCopy;
  readonly userProfilesSource?: UserProfilesSource;
  readonly currentOrigin: {
    profileId: string;
    title?: string | null;
  } | null;
  readonly onManage?: () => void;
}

function toProfileOptions(profiles: readonly NimiAIProfile[]): ModelConfigProfileOption[] {
  return profiles.map((profile) => ({
    profileId: profile.profileId,
    title: profile.title || profile.profileId,
    description: profile.description || '',
  }));
}

function scopeDependencyKey(scopeRef: NimiAIScopeRef): string {
  return `${scopeRef.kind}\0${scopeRef.ownerId}\0${scopeRef.surfaceId ?? ''}`;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  return 'Profile apply preview failed.';
}

function findProfile(profiles: readonly NimiAIProfile[], profileId: string): NimiAIProfile | null {
  for (const profile of profiles) {
    if (profile.profileId === profileId) {
      return profile;
    }
  }
  return null;
}

function toDisplayPreview(
  profileId: string,
  profileTitle: string,
  preview: NimiAIProfilePreviewResult,
): ModelConfigProfilePreview {
  const summary = summarizeProfilePreview({ profileId, preview });
  return {
    profileId,
    profileTitle,
    isFirstApply: summary.isFirstApply,
    identical: summary.identical,
    rows: summary.rows.map((row) => ({
      path: row.path,
      changeKind: row.changeKind,
      beforeText: row.beforeText,
      afterText: row.afterText,
    })),
    probeWarnings: [...summary.probeWarnings],
  };
}

/**
 * Default kit hook that composes SharedAIConfigService + optional user profile
 * fallback into a ModelConfigProfileController.
 *
 * Apply is preview-gated (D-AIPC-014 / S-AICONF-008): `onApply` computes a
 * non-committing before→after NimiAIConfig preview, the panel surfaces the diff,
 * and only `onConfirmApply` performs the D-AIPC-005 atomic commit. There is no
 * immediate-commit path for profile apply on this surface.
 *
 * Commit resolves the canonical apply paths:
 *   remote-success / remote-fail-without-user-profile / network-error.
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
  } = input;
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<ModelConfigProfilePreview | null>(null);
  const [pendingPreview, setPendingPreview] = useState<NimiAIProfilePreviewResult | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ReadonlyArray<NimiAIProfile>>([]);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const scopeKey = scopeDependencyKey(scopeRef);
  const scopeRefRef = useRef(scopeRef);
  const userProfilesSourceRef = useRef<UserProfilesSource | undefined>(userProfilesSource);
  const profilesRef = useRef<ReadonlyArray<NimiAIProfile>>([]);

  scopeRefRef.current = scopeRef;
  userProfilesSourceRef.current = userProfilesSource;
  profilesRef.current = profiles;

  const stableUserProfilesSource = useMemo<UserProfilesSource>(() => ({
    list: () => userProfilesSourceRef.current?.list() ?? [],
  }), []);

  const core = useMemo(
    () => createModelConfigProfileControllerCore({
      scopeRef: scopeRefRef.current,
      service: aiConfigService,
      userProfilesSource: stableUserProfilesSource,
    }),
    [aiConfigService, scopeKey, stableUserProfilesSource],
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
        const userProfiles = [...stableUserProfilesSource.list()];
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
  }, [aiConfigService, reloadToken, scopeKey, stableUserProfilesSource]);

  const profileOptions = useMemo(() => toProfileOptions(profiles), [profiles]);

  const profileTitleFor = useCallback((profileId: string): string => {
    const match = findProfile(profilesRef.current, profileId);
    return match?.title || profileId;
  }, []);

  // Step 1 — preview (D-AIPC-014). Non-committing: no aiConfig.update call.
  const handleApply = useCallback((profileId: string) => {
    if (!profileId) return;
    setPreviewing(true);
    setApplyError(null);
    setPreview(null);
    setPendingPreview(null);
    const currentScopeRef = scopeRefRef.current;
    void aiConfigService.aiProfile.previewApply(currentScopeRef, profileId)
      .then((previewResult: NimiAIProfilePreviewResult) => {
        setPendingPreview(previewResult);
        setPreview(toDisplayPreview(profileId, profileTitleFor(profileId), previewResult));
      })
      .catch((error: unknown) => {
        setApplyError(describeError(error));
      })
      .finally(() => {
        setPreviewing(false);
      });
  }, [aiConfigService, profileTitleFor]);

  // Step 2 — commit (D-AIPC-005), only on explicit confirm of the preview.
  const handleConfirmApply = useCallback(() => {
    if (!pendingPreview) return;
    const profileId = preview?.profileId;
    if (!profileId) return;
    setApplying(true);
    setApplyError(null);
    const currentScopeRef = scopeRefRef.current;
    void aiConfigService.aiProfile.apply(currentScopeRef, profileId, {
      expectedBaseVersion: pendingPreview.baseVersion,
    })
      .then((remoteResult: NimiAIProfileApplyResult) => {
        const resolution = core.resolveRemoteApply({
          profileId,
          remoteResult,
          currentConfig: aiConfigService.aiConfig.get(currentScopeRef),
          now: () => new Date().toISOString(),
        });
        if (resolution.kind === 'remote-success') {
          aiConfigService.aiConfig.update(currentScopeRef, resolution.nextConfig);
          setPreview(null);
          setPendingPreview(null);
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
  }, [aiConfigService, core, pendingPreview, preview]);

  const handleCancelPreview = useCallback(() => {
    setPreview(null);
    setPendingPreview(null);
    setApplyError(null);
  }, []);

  return {
    currentOrigin,
    profiles: profileOptions,
    selectedProfileId,
    isLoading: loading,
    isReloading: reloading,
    error: applyError || loadError,
    applying,
    previewing,
    preview,
    copy,
    onSelectedProfileChange: setSelectedProfileId,
    onApply: handleApply,
    onConfirmApply: handleConfirmApply,
    onCancelPreview: handleCancelPreview,
    onManage,
    onReload: () => {
      setReloadToken((prev) => prev + 1);
    },
  };
}

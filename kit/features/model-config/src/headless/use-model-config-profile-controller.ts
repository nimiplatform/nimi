import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  NimiAICapabilityRequirementDeclaration,
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
  ModelConfigProfileCapabilitySummary,
  ModelConfigProfileCopy,
  ModelConfigProfileOption,
  ModelConfigProfilePreview,
} from '../types.js';

export interface UseModelConfigProfileControllerInput {
  readonly scopeRef: NimiAIScopeRef;
  readonly aiConfigService: SharedAIConfigService;
  readonly requirementDeclaration: NimiAICapabilityRequirementDeclaration;
  readonly copy: ModelConfigProfileCopy;
  readonly userProfilesSource?: UserProfilesSource;
  readonly currentOrigin: {
    profileId: string;
    title?: string | null;
  } | null;
  readonly onManage?: () => void;
}

function asObject(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function profileParameterSummary(value: unknown): string[] {
  const params = asObject(value);
  const out: string[] = [];
  const size = normalizedText(params.size);
  const steps = normalizedText(params.steps ?? params.step);
  const cfgScale = normalizedText(params.cfgScale ?? params.cfg_scale);
  const sampler = normalizedText(params.sampler ?? params.mode);
  const scheduler = normalizedText(params.scheduler);
  if (size) out.push(size);
  if (steps) out.push(`${steps} steps`);
  if (cfgScale) out.push(`CFG ${cfgScale}`);
  if (sampler) out.push(sampler);
  if (scheduler) out.push(scheduler);
  return out;
}

function profileCapabilitySummaries(profile: NimiAIProfile): ModelConfigProfileCapabilitySummary[] {
  const bindings = new Map((profile.assetBindings ?? []).map((binding) => [binding.bindingId, binding]));
  const out: ModelConfigProfileCapabilitySummary[] = [];
  for (const [capabilityId, intent] of Object.entries(profile.capabilities)) {
    if (!intent) continue;
    const descriptor = intent.runtimeDescriptor;
    const occurrences = [...(descriptor?.orderedCompanionOccurrences ?? [])]
      .sort((left, right) => left.order - right.order);
    const companionBindingIds = new Set(occurrences.map((occurrence) => occurrence.assetBindingRef));
    const mainBinding = (descriptor?.assetRefs ?? [])
      .map((bindingRef) => bindings.get(bindingRef))
      .find((binding) => binding?.assetRole === 'main')
      ?? (descriptor?.assetRefs ?? [])
        .filter((bindingRef) => !companionBindingIds.has(bindingRef))
        .map((bindingRef) => bindings.get(bindingRef))
        .find(Boolean);
    const logicalModelId = normalizedText(intent.logicalModelId);
    const descriptorModelId = normalizedText(descriptor?.modelId);
    const mainIdentity = normalizedText(mainBinding?.expectedIdentity);
    out.push({
      capabilityId,
      ...(logicalModelId ? { logicalModelId } : {}),
      ...(logicalModelId || descriptorModelId || mainIdentity
        ? { modelLabel: logicalModelId || descriptorModelId || mainIdentity }
        : {}),
      ...(normalizedText(descriptor?.model?.family)
        ? { modelFamily: normalizedText(descriptor?.model?.family) }
        : {}),
      ...(descriptor?.executionMode ? { executionMode: descriptor.executionMode } : {}),
      components: occurrences.map((occurrence) => {
        const binding = bindings.get(occurrence.assetBindingRef);
        return {
          role: occurrence.role,
          engineSlot: occurrence.engineSlot,
          label: normalizedText(binding?.expectedIdentity) || occurrence.assetBindingRef,
          required: occurrence.required,
        };
      }),
      parameterSummary: profileParameterSummary(intent.params),
    });
  }
  return out;
}

function toProfileOptions(profiles: readonly NimiAIProfile[]): ModelConfigProfileOption[] {
  return profiles.map((profile) => {
    const capabilitySummaries = profileCapabilitySummaries(profile);
    return {
      profileId: profile.profileId,
      title: profile.title || profile.profileId,
      description: profile.description || '',
      capabilitySummaries,
      setupRequired: capabilitySummaries.length === 0
        || capabilitySummaries.every((summary) => (
          !summary.logicalModelId
          && !summary.modelLabel
          && summary.components.length === 0
        )),
    };
  });
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

function describePreviewFailure(preview: NimiAIProfilePreviewResult): string {
  const setupProjection = preview.setupProjection;
  const capabilities = setupProjection?.blockingCapabilities?.join(', ') || '';
  const reasons = setupProjection?.reasonCodes?.join(', ') || '';
  const details = [
    capabilities ? `blocking capabilities: ${capabilities}` : '',
    reasons ? `reason codes: ${reasons}` : '',
  ].filter(Boolean).join('; ');
  return details
    ? `Profile apply preview is not ready (${preview.outcome}; ${details}).`
    : `Profile apply preview is not ready (${preview.outcome}).`;
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
    requirementDeclaration,
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
  const previewRequestRef = useRef(0);
  const applyRequestRef = useRef(0);

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
  const currentProfile = useMemo(
    () => profileOptions.find((profile) => profile.profileId === currentOrigin?.profileId) ?? null,
    [currentOrigin?.profileId, profileOptions],
  );

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
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    const currentScopeRef = scopeRefRef.current;
    void aiConfigService.aiProfile.previewApply(currentScopeRef, profileId, {
      requirementDeclarations: [requirementDeclaration],
    })
      .then((previewResult: NimiAIProfilePreviewResult) => {
        if (previewRequestRef.current !== requestId) return;
        if (previewResult.outcome !== 'ready_to_apply' || !previewResult.after) {
          setApplyError(describePreviewFailure(previewResult));
          return;
        }
        setPendingPreview(previewResult);
        setPreview(toDisplayPreview(profileId, profileTitleFor(profileId), previewResult));
      })
      .catch((error: unknown) => {
        if (previewRequestRef.current !== requestId) return;
        setApplyError(describeError(error));
      })
      .finally(() => {
        if (previewRequestRef.current !== requestId) return;
        setPreviewing(false);
      });
  }, [aiConfigService, profileTitleFor, requirementDeclaration]);

  // Step 2 — commit (D-AIPC-005), only on explicit confirm of the preview.
  const handleConfirmApply = useCallback(() => {
    if (!pendingPreview) return;
    const profileId = preview?.profileId;
    if (!profileId) return;
    setApplying(true);
    setApplyError(null);
    const requestId = applyRequestRef.current + 1;
    applyRequestRef.current = requestId;
    const currentScopeRef = scopeRefRef.current;
    void aiConfigService.aiProfile.apply(currentScopeRef, profileId, {
      expectedBaseVersion: pendingPreview.baseVersion,
      requirementDeclarations: [requirementDeclaration],
    })
      .then((remoteResult: NimiAIProfileApplyResult) => {
        if (applyRequestRef.current !== requestId) return undefined;
        const resolution = core.resolveRemoteApply({
          profileId,
          remoteResult,
          currentConfig: aiConfigService.aiConfig.get(currentScopeRef),
          now: () => new Date().toISOString(),
        });
        if (resolution.kind === 'remote-success') {
          setPreview(null);
          setPendingPreview(null);
          return undefined;
        }
        setApplyError(resolution.failureReason);
        return undefined;
      })
      .catch((error: unknown) => {
        if (applyRequestRef.current !== requestId) return;
        const resolution = core.resolveNetworkError({ profileId, error });
        setApplyError(resolution.kind === 'network-error' ? resolution.failureReason : 'Profile apply failed.');
      })
      .finally(() => {
        if (applyRequestRef.current !== requestId) return;
        setApplying(false);
      });
  }, [aiConfigService, core, pendingPreview, preview, requirementDeclaration]);

  const handleCancelPreview = useCallback(() => {
    previewRequestRef.current += 1;
    applyRequestRef.current += 1;
    setPreview(null);
    setPendingPreview(null);
    setApplyError(null);
  }, []);

  return {
    currentOrigin,
    currentProfile,
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

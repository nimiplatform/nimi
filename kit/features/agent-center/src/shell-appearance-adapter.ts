import type {
  NimiRuntimeAgentPresentationProfileProjection,
  RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  validateAgentCenterAvatarAssetImportResult,
  validateAgentCenterAvatarPreviewResolveResult,
  validateAgentCenterAvatarAssetValidateResult,
  validateAgentCenterBackgroundImportResult,
  validateAgentCenterBackgroundValidateResult,
  validateAgentCenterLive2dSidecarImportResult,
  validateAgentCenterResourceRemovalResult,
  type AgentCenterAvatarBackendKind,
} from './preview-resolve.js';
import type {
  AgentCenterAppearanceAdapter,
  AgentCenterAppearanceProjection,
  AgentCenterHostScope,
  AgentCenterRuntimePresentationProfilePatch,
  AgentCenterRuntimePresentationProfileSurface,
  AgentCenterRuntimeSnapshot,
} from './types.js';

export interface AgentCenterShellAppearanceBridgeScope {
  readonly hostScope: AgentCenterHostScope;
  readonly accountId?: string;
  readonly ownerUserId?: string;
  readonly runtimeSourceRef?: string;
  readonly localAgentRef?: string;
}

export interface AgentCenterShellAppearanceBridge {
  readonly importLive2dAvatarAsset: (scope: AgentCenterShellAppearanceBridgeScope) => Promise<unknown | null>;
  readonly importVrmAvatarAsset: (scope: AgentCenterShellAppearanceBridgeScope) => Promise<unknown | null>;
  readonly validateAvatarAsset: (payload: AgentCenterShellAppearanceBridgeScope & { readonly avatarAssetRef: string }) => Promise<unknown>;
  readonly resolveAvatarAssetPreview?: (
    payload: AgentCenterShellAppearanceBridgeScope & { readonly avatarAssetRef: string; readonly backendKind?: AgentCenterAvatarBackendKind }
  ) => Promise<unknown>;
  readonly importLive2dAdapterManifest?: (payload: AgentCenterShellAppearanceBridgeScope & { readonly avatarAssetRef: string }) => Promise<unknown | null>;
  readonly importBackground?: (scope: AgentCenterShellAppearanceBridgeScope) => Promise<unknown | null>;
  readonly validateBackground?: (payload: AgentCenterShellAppearanceBridgeScope & { readonly backgroundAssetRef: string }) => Promise<unknown>;
  readonly removeBackground?: (payload: AgentCenterShellAppearanceBridgeScope & { readonly backgroundAssetRef: string }) => Promise<unknown>;
  readonly removeAgentResources?: (payload: AgentCenterShellAppearanceBridgeScope & { readonly localAgentRef: string }) => Promise<unknown>;
  readonly removeAccountResources?: (payload: { readonly accountId?: string }) => Promise<unknown>;
}

export interface CreateAgentCenterShellAppearanceAdapterInput {
  readonly identity: RuntimeLocalAgentIdentityInput;
  readonly accountId?: string | null;
  readonly runtimePresentation: AgentCenterRuntimePresentationProfileSurface;
  readonly shell?: AgentCenterShellAppearanceBridge | null;
  readonly snapshot?: AgentCenterRuntimeSnapshot | null;
  readonly loadSnapshot?: () => Promise<AgentCenterRuntimeSnapshot | null>;
}

const EMPTY_PROFILE: NimiRuntimeAgentPresentationProfileProjection = {
  backendKind: null,
  avatarAssetRef: null,
  expressionProfileRef: null,
  idlePreset: null,
  interactionPolicyRef: null,
  defaultVoiceReference: null,
  avatarAutoplay: false,
  backgroundAssetRef: null,
};

export function createAgentCenterShellAppearanceAdapter(
  input: CreateAgentCenterShellAppearanceAdapterInput,
): AgentCenterAppearanceAdapter {
  let committedProfile = presentationProfileFromSnapshot(input.snapshot) || EMPTY_PROFILE;
  let sidecar: Pick<AgentCenterAppearanceProjection, 'live2dAdapterManifestRef' | 'live2dAdapterManifestSource'> = {};

  const scope = (): AgentCenterShellAppearanceBridgeScope => ({
    hostScope: 'local-agent',
    accountId: normalizeOptionalText(input.accountId) || undefined,
    ownerUserId: requireText(input.identity.ownerUserId, 'ownerUserId'),
    runtimeSourceRef: requireText(input.identity.runtimeSourceRef, 'runtimeSourceRef'),
    localAgentRef: requireText(input.identity.localAgentRef, 'localAgentRef'),
  });

  const refresh = async (): Promise<AgentCenterAppearanceProjection> => {
    const snapshot = input.loadSnapshot ? await input.loadSnapshot() : input.snapshot;
    committedProfile = presentationProfileFromSnapshot(snapshot) || committedProfile || EMPTY_PROFILE;
    return projectAppearance(committedProfile, input.shell || null, sidecar, scope());
  };

  const patchRuntimeProfile = async (
    patch: AgentCenterRuntimePresentationProfilePatch,
  ): Promise<AgentCenterAppearanceProjection> => {
    await input.runtimePresentation.patchPresentationProfile(input.identity, normalizePatch(patch));
    committedProfile = mergeProfile(committedProfile, patch);
    return projectAppearance(committedProfile, input.shell || null, sidecar, scope());
  };

  return {
    load: refresh,
    ...(input.shell ? { async importAvatarAsset(kind: 'live2d' | 'vrm') {
      const shell = input.shell as AgentCenterShellAppearanceBridge;
      const raw = kind === 'vrm'
        ? await shell.importVrmAvatarAsset(scope())
        : await shell.importLive2dAvatarAsset(scope());
      if (!raw) {
        return { ...await refresh(), avatarImportError: 'Avatar import was cancelled before a source was selected.' };
      }
      const result = validateAgentCenterAvatarAssetImportResult(raw);
      if (normalizeBackendKind(result.backendKind) !== kind) {
        throw new Error(`Agent Center shell returned ${result.backendKind} for ${kind} import.`);
      }
      return patchRuntimeProfile({
        backendKind: normalizeBackendKind(result.backendKind),
        avatarAssetRef: result.avatarAssetRef,
      });
    } } : {}),
    ...(input.shell?.importLive2dAdapterManifest ? { async linkLive2dAdapterManifest() {
      const shell = input.shell as AgentCenterShellAppearanceBridge;
      const avatarAssetRef = committedProfile.avatarAssetRef;
      if (!avatarAssetRef) {
        throw new Error('Agent Center requires a selected avatar before importing a Live2D adapter manifest.');
      }
      const raw = await shell.importLive2dAdapterManifest?.({ ...scope(), avatarAssetRef });
      if (!raw) {
        return refresh();
      }
      const result = validateAgentCenterLive2dSidecarImportResult(raw);
      sidecar = {
        live2dAdapterManifestRef: result.live2dAdapterManifestRef,
        live2dAdapterManifestSource: result.live2dAdapterManifestSource,
      };
      return refresh();
    } } : {}),
    async clearAvatarAsset() {
      sidecar = {};
      return patchRuntimeProfile({ avatarAssetRef: '' });
    },
    ...(input.shell?.importBackground ? { async importBackground() {
      const shell = input.shell as AgentCenterShellAppearanceBridge;
      const raw = await shell.importBackground?.(scope());
      if (!raw) {
        return { ...await refresh(), backgroundImportError: 'Background import was cancelled before a source was selected.' };
      }
      const result = validateAgentCenterBackgroundImportResult(raw);
      return patchRuntimeProfile({ backgroundAssetRef: result.backgroundAssetRef });
    } } : {}),
    async clearBackground() {
      const backgroundRef = committedProfile.backgroundAssetRef;
      if (backgroundRef && input.shell?.removeBackground) {
        validateAgentCenterResourceRemovalResult(await input.shell.removeBackground({ ...scope(), backgroundAssetRef: backgroundRef }));
      }
      return patchRuntimeProfile({ backgroundAssetRef: '' });
    },
    ...(input.shell?.removeAgentResources ? { async removeAgentResources() {
      const shell = input.shell as AgentCenterShellAppearanceBridge;
      validateAgentCenterResourceRemovalResult(await shell.removeAgentResources?.(scope() as AgentCenterShellAppearanceBridgeScope & { readonly localAgentRef: string }));
      sidecar = {};
      return patchRuntimeProfile({ avatarAssetRef: '', backgroundAssetRef: '' });
    } } : {}),
    ...(input.shell?.removeAccountResources ? { async removeAccountResources() {
      const shell = input.shell as AgentCenterShellAppearanceBridge;
      validateAgentCenterResourceRemovalResult(await shell.removeAccountResources?.({
        accountId: normalizeOptionalText(input.accountId) || undefined,
      }));
      return refresh();
    } } : {}),
    async setAvatarAutoplay(enabled) {
      return patchRuntimeProfile({ avatarAutoplay: enabled });
    },
  };
}

async function projectAppearance(
  profile: NimiRuntimeAgentPresentationProfileProjection,
  shell: AgentCenterShellAppearanceBridge | null,
  sidecar: Pick<AgentCenterAppearanceProjection, 'live2dAdapterManifestRef' | 'live2dAdapterManifestSource'>,
  scope: AgentCenterShellAppearanceBridgeScope,
): Promise<AgentCenterAppearanceProjection> {
  const avatarAssetRef = profile.avatarAssetRef || null;
  const backgroundRef = profile.backgroundAssetRef || null;
  const [avatarValidation, backgroundValidation] = await Promise.all([
    avatarAssetRef
      ? shell?.validateAvatarAsset({ ...scope, avatarAssetRef }).then(validateAgentCenterAvatarAssetValidateResult) ?? Promise.resolve(null)
      : Promise.resolve(null),
    backgroundRef && shell?.validateBackground
      ? shell.validateBackground({ ...scope, backgroundAssetRef: backgroundRef }).then(validateAgentCenterBackgroundValidateResult)
      : Promise.resolve(null),
  ]);
  const preview = avatarAssetRef && shell?.resolveAvatarAssetPreview
    ? await shell.resolveAvatarAssetPreview({
      ...scope,
      avatarAssetRef,
      ...(profile.backendKind ? { backendKind: profile.backendKind } : {}),
    }).then(validateAgentCenterAvatarPreviewResolveResult).then((result) => ({
      previewState: result.validationStatus === 'invalid' ? 'failed' as const : 'ready' as const,
      previewTier: 'avatar_preview_service' as const,
      previewArtifactRef: result.previewArtifactRef,
      previewImageRef: result.previewImageRef ?? null,
      previewFailureReason: result.validationStatus === 'invalid' ? result.validationMessage ?? 'avatar_preview_service validation failed' : null,
      previewWarnings: result.warnings ?? [],
    })).catch((error: unknown) => ({
      previewState: 'failed' as const,
      previewTier: 'avatar_preview_service' as const,
      previewArtifactRef: null,
      previewImageRef: null,
      previewFailureReason: error instanceof Error ? error.message : 'avatar_preview_service resolve failed',
      previewWarnings: [],
    }))
    : null;
  const validationStatus = avatarValidation?.validationStatus ?? null;
  const backgroundValidationStatus = backgroundValidation?.validationStatus ?? null;
  return {
    status: !avatarAssetRef
      ? 'not_configured'
      : validationStatus === 'invalid'
        ? 'invalid'
        : 'ready',
    backendKind: profile.backendKind,
    avatarAssetRef,
    avatarAssetValid: validationStatus === 'valid',
    avatarAssetChecking: validationStatus === 'checking',
    validationStatus,
    validationMessage: avatarValidation?.validationMessage ?? null,
    validationIssueRows: avatarValidation?.validationIssueRows ?? [],
    backendCapabilityProfileRef: avatarValidation?.backendCapabilityProfileRef ?? null,
    backgroundRef,
    backgroundValid: backgroundValidationStatus === 'valid',
    backgroundChecking: backgroundValidationStatus === 'checking',
    backgroundValidationStatus,
    backgroundValidationMessage: backgroundValidation?.validationMessage ?? null,
    previewState: preview?.previewState ?? (avatarAssetRef ? 'unavailable' : null),
    previewTier: preview?.previewTier ?? null,
    previewArtifactRef: preview?.previewArtifactRef ?? null,
    previewImageRef: preview?.previewImageRef ?? null,
    previewFailureReason: preview?.previewFailureReason ?? null,
    previewWarnings: preview?.previewWarnings ?? [],
    defaultVoiceReference: profile.defaultVoiceReference,
    avatarAutoplay: profile.avatarAutoplay,
    avatarImportDisabled: !shell,
    backgroundImportDisabled: !shell?.importBackground,
    disabledReason: avatarAssetRef ? null : 'appearance asset not configured',
    ...sidecar,
  };
}

function presentationProfileFromSnapshot(
  snapshot: AgentCenterRuntimeSnapshot | null | undefined,
): NimiRuntimeAgentPresentationProfileProjection | null {
  return snapshot?.inspect?.presentationProfile || null;
}

function normalizePatch(
  patch: AgentCenterRuntimePresentationProfilePatch,
): AgentCenterRuntimePresentationProfilePatch {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => [
    key,
    typeof value === 'string' ? value.trim() : value,
  ])) as AgentCenterRuntimePresentationProfilePatch;
}

function mergeProfile(
  profile: NimiRuntimeAgentPresentationProfileProjection,
  patch: AgentCenterRuntimePresentationProfilePatch,
): NimiRuntimeAgentPresentationProfileProjection {
  return {
    ...profile,
    backendKind: Object.prototype.hasOwnProperty.call(patch, 'backendKind')
      ? normalizeBackendKind(patch.backendKind)
      : profile.backendKind,
    avatarAssetRef: Object.prototype.hasOwnProperty.call(patch, 'avatarAssetRef')
      ? normalizeOptionalText(patch.avatarAssetRef)
      : profile.avatarAssetRef,
    expressionProfileRef: Object.prototype.hasOwnProperty.call(patch, 'expressionProfileRef')
      ? normalizeOptionalText(patch.expressionProfileRef)
      : profile.expressionProfileRef,
    idlePreset: Object.prototype.hasOwnProperty.call(patch, 'idlePreset')
      ? normalizeOptionalText(patch.idlePreset)
      : profile.idlePreset,
    interactionPolicyRef: Object.prototype.hasOwnProperty.call(patch, 'interactionPolicyRef')
      ? normalizeOptionalText(patch.interactionPolicyRef)
      : profile.interactionPolicyRef,
    defaultVoiceReference: Object.prototype.hasOwnProperty.call(patch, 'defaultVoiceReference')
      ? normalizeOptionalText(patch.defaultVoiceReference)
      : profile.defaultVoiceReference,
    avatarAutoplay: Object.prototype.hasOwnProperty.call(patch, 'avatarAutoplay')
      ? patch.avatarAutoplay === true
      : profile.avatarAutoplay,
    backgroundAssetRef: Object.prototype.hasOwnProperty.call(patch, 'backgroundAssetRef')
      ? normalizeOptionalText(patch.backgroundAssetRef)
      : profile.backgroundAssetRef,
  };
}

function normalizeBackendKind(value: unknown): NimiRuntimeAgentPresentationProfileProjection['backendKind'] {
  const text = normalizeOptionalText(value) as AgentCenterAvatarBackendKind | null;
  if (text === 'vrm' || text === 'live2d' || text === 'sprite2d' || text === 'canvas2d' || text === 'video') {
    return text;
  }
  return null;
}

function normalizeOptionalText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function requireText(value: unknown, field: string): string {
  const text = normalizeOptionalText(value);
  if (!text) {
    throw new Error(`Agent Center shell appearance adapter requires ${field}.`);
  }
  return text;
}

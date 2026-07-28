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
import {
  isAgentCenterAvatarPreviewReady,
} from './appearance-preview-readiness.js';
import { resolveAgentCenterAvatarPreviewProjection } from './avatar-preview-adapter.js';
import type {
  AgentCenterAppearanceAdapter,
  AgentCenterAvatarPreviewAdapter,
  AgentCenterAppearanceProjection,
  AgentCenterRuntimePresentationProfilePatch,
  AgentCenterRuntimePresentationProfileSurface,
  AgentCenterRuntimeSnapshot,
} from './types.js';

export interface AgentCenterShellAppearanceBridgeScope {
  readonly hostScope: 'local-agent';
  readonly accountId: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
}

export interface AgentCenterShellAppearanceBridgeAccountScope {
  readonly hostScope: 'account';
  readonly accountId: string;
}

type AgentCenterShellAvatarBackendKind = Extract<AgentCenterAvatarBackendKind, 'live2d' | 'vrm'>;

export interface AgentCenterShellAppearanceBridge {
  readonly importLive2dAvatarAsset: (scope: AgentCenterShellAppearanceBridgeScope) => Promise<unknown | null>;
  readonly importVrmAvatarAsset: (scope: AgentCenterShellAppearanceBridgeScope) => Promise<unknown | null>;
  readonly validateAvatarAsset: (payload: AgentCenterShellAppearanceBridgeScope & { readonly avatarAssetRef: string }) => Promise<unknown>;
  readonly resolveAvatarAssetPreview?: (
    payload: AgentCenterShellAppearanceBridgeScope & { readonly avatarAssetRef: string; readonly backendKind?: AgentCenterShellAvatarBackendKind }
  ) => Promise<unknown>;
  readonly importLive2dAdapterManifest?: (payload: AgentCenterShellAppearanceBridgeScope & { readonly avatarAssetRef: string }) => Promise<unknown | null>;
  readonly importBackground?: (scope: AgentCenterShellAppearanceBridgeScope) => Promise<unknown | null>;
  readonly validateBackground?: (payload: AgentCenterShellAppearanceBridgeScope & { readonly backgroundAssetRef: string }) => Promise<unknown>;
  readonly removeBackground?: (payload: AgentCenterShellAppearanceBridgeScope & { readonly backgroundAssetRef: string }) => Promise<unknown>;
  readonly removeAgentResources?: (payload: AgentCenterShellAppearanceBridgeScope & { readonly localAgentRef: string }) => Promise<unknown>;
  readonly removeAccountResources?: (payload: AgentCenterShellAppearanceBridgeAccountScope) => Promise<unknown>;
}

export interface CreateAgentCenterShellAppearanceAdapterInput {
  readonly identity: RuntimeLocalAgentIdentityInput;
  readonly accountId: string;
  readonly runtimePresentation: AgentCenterRuntimePresentationProfileSurface;
  readonly shell?: AgentCenterShellAppearanceBridge | null;
  readonly avatarPreview?: AgentCenterAvatarPreviewAdapter | null;
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
  let committedRevision = presentationRevisionFromSnapshot(input.snapshot);
  let sidecar: Pick<AgentCenterAppearanceProjection, 'live2dAdapterManifestRef' | 'live2dAdapterManifestSource'> = {};
  let resourceCleanupError: string | null = null;
  let transactionTail: Promise<void> = Promise.resolve();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = transactionTail.then(operation, operation);
    transactionTail = pending.then(() => undefined, () => undefined);
    return pending;
  };

  const scope = (): AgentCenterShellAppearanceBridgeScope => ({
    hostScope: 'local-agent',
    accountId: requireText(input.accountId, 'accountId'),
    ownerUserId: requireText(input.identity.ownerUserId, 'ownerUserId'),
    runtimeSourceRef: requireText(input.identity.runtimeSourceRef, 'runtimeSourceRef'),
    localAgentRef: requireText(input.identity.localAgentRef, 'localAgentRef'),
  });

  const refreshUnsafe = async (): Promise<AgentCenterAppearanceProjection> => {
    if (input.loadSnapshot) {
      const snapshot = await input.loadSnapshot();
      committedProfile = presentationProfileFromSnapshot(snapshot) || committedProfile || EMPTY_PROFILE;
      committedRevision = presentationRevisionFromSnapshot(snapshot) ?? committedRevision;
    }
    return projectAppearance(
      committedProfile,
      input.shell || null,
      input.avatarPreview || null,
      sidecar,
      resourceCleanupError,
      scope(),
      input.identity,
    );
  };

  const commitRuntimePatchUnsafe = async (
    patch: AgentCenterRuntimePresentationProfilePatch,
  ): Promise<void> => {
    if (committedRevision === null) {
      throw new Error('Agent Center Runtime presentation revision is unavailable.');
    }
    const result = await input.runtimePresentation.patchPresentationProfile(
      input.identity,
      normalizePatch(patch),
      committedRevision,
    );
    committedProfile = result.profile || EMPTY_PROFILE;
    committedRevision = result.committedRevision;
  };

  const projectUnsafe = () => projectAppearance(
    committedProfile,
    input.shell || null,
    input.avatarPreview || null,
    sidecar,
    resourceCleanupError,
    scope(),
    input.identity,
  );

  const patchAndProjectUnsafe = async (patch: AgentCenterRuntimePresentationProfilePatch) => {
    await commitRuntimePatchUnsafe(patch);
    return projectUnsafe();
  };

  return {
    load: () => enqueue(refreshUnsafe),
    ...(input.shell ? { async importAvatarAsset(kind: 'live2d' | 'vrm') {
      return enqueue(async () => {
        const shell = input.shell as AgentCenterShellAppearanceBridge;
        const raw = kind === 'vrm'
          ? await shell.importVrmAvatarAsset(scope())
          : await shell.importLive2dAvatarAsset(scope());
        if (!raw) {
          return { ...await refreshUnsafe(), avatarImportError: 'Avatar import was cancelled before a source was selected.' };
        }
        const result = validateAgentCenterAvatarAssetImportResult(raw);
        if (normalizeBackendKind(result.backendKind) !== kind) {
          throw new Error(`Agent Center shell returned ${result.backendKind} for ${kind} import.`);
        }
        return patchAndProjectUnsafe({
          backendKind: normalizeBackendKind(result.backendKind),
          avatarAssetRef: result.avatarAssetRef,
          expressionProfileRef: null,
          idlePreset: null,
          interactionPolicyRef: null,
        });
      });
    } } : {}),
    ...(input.shell?.importLive2dAdapterManifest ? { async linkLive2dAdapterManifest() {
      return enqueue(async () => {
        const shell = input.shell as AgentCenterShellAppearanceBridge;
        const avatarAssetRef = committedProfile.avatarAssetRef;
        if (!avatarAssetRef) {
          throw new Error('Agent Center requires a selected avatar before importing a Live2D adapter manifest.');
        }
        const raw = await shell.importLive2dAdapterManifest?.({ ...scope(), avatarAssetRef });
        if (!raw) return refreshUnsafe();
        const result = validateAgentCenterLive2dSidecarImportResult(raw);
        sidecar = {
          live2dAdapterManifestRef: result.live2dAdapterManifestRef,
          live2dAdapterManifestSource: result.live2dAdapterManifestSource,
        };
        return projectUnsafe();
      });
    } } : {}),
    async clearAvatarAsset() {
      return enqueue(async () => {
        await commitRuntimePatchUnsafe({
          backendKind: null,
          avatarAssetRef: '',
          expressionProfileRef: null,
          idlePreset: null,
          interactionPolicyRef: null,
        });
        sidecar = {};
        return projectUnsafe();
      });
    },
    ...(input.shell?.importBackground ? { async importBackground() {
      return enqueue(async () => {
        const shell = input.shell as AgentCenterShellAppearanceBridge;
        const raw = await shell.importBackground?.(scope());
        if (!raw) {
          return { ...await refreshUnsafe(), backgroundImportError: 'Background import was cancelled before a source was selected.' };
        }
        const result = validateAgentCenterBackgroundImportResult(raw);
        return patchAndProjectUnsafe({ backgroundAssetRef: result.backgroundAssetRef });
      });
    } } : {}),
    async clearBackground() {
      return enqueue(async () => {
        const backgroundRef = committedProfile.backgroundAssetRef;
        await commitRuntimePatchUnsafe({ backgroundAssetRef: '' });
        resourceCleanupError = null;
        if (backgroundRef) {
          if (!input.shell?.removeBackground) {
            resourceCleanupError = `Background custody cleanup for ${backgroundRef} is unavailable because Shell removeBackground is not connected.`;
          } else {
            try {
              validateAgentCenterResourceRemovalResult(await input.shell.removeBackground({ ...scope(), backgroundAssetRef: backgroundRef }));
            } catch (error) {
              resourceCleanupError = errorMessage(error);
            }
          }
        }
        return projectUnsafe();
      });
    },
    ...(input.shell?.removeAgentResources ? { async removeAgentResources() {
      return enqueue(async () => {
        const shell = input.shell as AgentCenterShellAppearanceBridge;
        await commitRuntimePatchUnsafe({
          backendKind: null,
          avatarAssetRef: '',
          expressionProfileRef: null,
          idlePreset: null,
          interactionPolicyRef: null,
          backgroundAssetRef: '',
        });
        sidecar = {};
        resourceCleanupError = null;
        try {
          validateAgentCenterResourceRemovalResult(await shell.removeAgentResources?.(scope() as AgentCenterShellAppearanceBridgeScope & { readonly localAgentRef: string }));
        } catch (error) {
          resourceCleanupError = errorMessage(error);
        }
        return projectUnsafe();
      });
    } } : {}),
    async setAvatarAutoplay(enabled) {
      return enqueue(() => patchAndProjectUnsafe({ avatarAutoplay: enabled }));
    },
  };
}

async function projectAppearance(
  profile: NimiRuntimeAgentPresentationProfileProjection,
  shell: AgentCenterShellAppearanceBridge | null,
  avatarPreview: AgentCenterAvatarPreviewAdapter | null,
  sidecar: Pick<AgentCenterAppearanceProjection, 'live2dAdapterManifestRef' | 'live2dAdapterManifestSource'>,
  resourceCleanupError: string | null,
  scope: AgentCenterShellAppearanceBridgeScope,
  identity: RuntimeLocalAgentIdentityInput,
): Promise<AgentCenterAppearanceProjection> {
  const avatarAssetRef = profile.avatarAssetRef || null;
  const backgroundRef = profile.backgroundAssetRef || null;
  const [avatarValidation, backgroundValidation] = await Promise.all([
    avatarAssetRef
      ? shell?.validateAvatarAsset({ ...scope, avatarAssetRef })
        .then(validateAgentCenterAvatarAssetValidateResult)
        .catch((error: unknown) => {
          const message = errorMessage(error);
          return {
            validationStatus: 'invalid' as const,
            validationMessage: message,
            validationIssueRows: [message],
            backendCapabilityProfileRef: null,
          };
        }) ?? Promise.resolve(null)
      : Promise.resolve(null),
    backgroundRef && shell?.validateBackground
      ? shell.validateBackground({ ...scope, backgroundAssetRef: backgroundRef })
        .then(validateAgentCenterBackgroundValidateResult)
        .catch((error: unknown) => ({ validationStatus: 'invalid' as const, validationMessage: errorMessage(error) }))
      : Promise.resolve(null),
  ]);
  const material = avatarAssetRef && avatarValidation?.validationStatus === 'valid' && shell?.resolveAvatarAssetPreview
    ? await shell.resolveAvatarAssetPreview({
      ...scope,
      avatarAssetRef,
      ...(profile.backendKind === 'live2d' || profile.backendKind === 'vrm'
        ? { backendKind: profile.backendKind }
        : {}),
    }).then(validateAgentCenterAvatarPreviewResolveResult).then((result) => {
      if (result.validationStatus === 'invalid') {
        throw new Error(result.validationMessage || 'Shell preview material validation failed.');
      }
      return { result, error: null as string | null };
    })
      .catch((error: unknown) => ({ result: null, error: errorMessage(error) }))
    : null;
  const preview = await resolveAgentCenterAvatarPreviewProjection({
    avatarAssetRef,
    backendKind: profile.backendKind,
    backendCapabilityProfileRef: 'backendCapabilityProfileRef' in (avatarValidation || {})
      ? avatarValidation?.backendCapabilityProfileRef ?? null
      : null,
    avatarValidationStatus: avatarValidation?.validationStatus ?? null,
    material,
    avatarPreview,
    identity,
    accountId: scope.accountId,
  });
  const validationStatus = avatarValidation?.validationStatus ?? null;
  const backgroundValidationStatus = backgroundValidation?.validationStatus ?? null;
  const projection: AgentCenterAppearanceProjection = {
    status: 'invalid',
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
    resourceCleanupError,
    previewMaterialRef: material?.result?.previewMaterialRef ?? null,
    previewState: preview?.previewState ?? (avatarAssetRef ? 'unavailable' : null),
    previewTier: preview?.previewTier ?? null,
    previewImageRef: preview?.previewImageRef ?? null,
    previewVisiblePixels: preview?.previewVisiblePixels ?? null,
    previewFailureReason: preview?.previewFailureReason ?? null,
    previewWarnings: preview?.previewWarnings ?? [],
    defaultVoiceReference: profile.defaultVoiceReference,
    avatarAutoplay: profile.avatarAutoplay,
    avatarImportDisabled: !shell,
    backgroundImportDisabled: !shell?.importBackground,
    disabledReason: !avatarAssetRef
      ? 'appearance asset not configured'
      : validationStatus === 'valid'
        ? null
        : avatarValidation?.validationMessage || 'appearance asset validation is unavailable',
    ...sidecar,
  };
  return {
    ...projection,
    status: !avatarAssetRef
      ? 'not_configured'
      : validationStatus === 'checking' || projection.previewState === 'loading'
        ? 'loading'
        : validationStatus === 'valid' && isAgentCenterAvatarPreviewReady(projection)
          ? 'ready'
          : 'invalid',
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function presentationProfileFromSnapshot(
  snapshot: AgentCenterRuntimeSnapshot | null | undefined,
): NimiRuntimeAgentPresentationProfileProjection | null {
  return snapshot?.inspect?.presentationProfile || null;
}

function presentationRevisionFromSnapshot(
  snapshot: AgentCenterRuntimeSnapshot | null | undefined,
): string | null {
  return snapshot?.inspect?.presentationProfileRevision ?? null;
}

function normalizePatch(
  patch: AgentCenterRuntimePresentationProfilePatch,
): AgentCenterRuntimePresentationProfilePatch {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => [
    key,
    typeof value === 'string' ? value.trim() : value,
  ])) as AgentCenterRuntimePresentationProfilePatch;
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

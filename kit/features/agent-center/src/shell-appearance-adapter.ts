import type {
  NimiRuntimeAgentPresentationProfileProjection,
  RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  AgentCenterAppearanceAdapter,
  AgentCenterAppearanceProjection,
  AgentCenterAvatarPreviewAdapter,
  AgentCenterPermissionedPresentationIntent,
  AgentCenterPresentationAssetMaterial,
  AgentCenterRuntimePresentationProfileMutationResult,
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

export interface AgentCenterShellPickedAvatarMaterial extends AgentCenterPresentationAssetMaterial {
  readonly role: 'avatar';
  readonly backendKind: 'live2d' | 'vrm';
  readonly custodyRef: string;
}

export interface AgentCenterShellAppearanceBridge {
  readonly pickAvatarAssetMaterial: (
    scope: AgentCenterShellAppearanceBridgeScope,
    backendKind: 'live2d' | 'vrm',
  ) => Promise<AgentCenterShellPickedAvatarMaterial | null>;
}

export interface CreateAgentCenterShellAppearanceAdapterInput {
  readonly identity: RuntimeLocalAgentIdentityInput;
  readonly accountId: string;
  readonly runtimePresentation: AgentCenterRuntimePresentationProfileSurface;
  readonly shell?: AgentCenterShellAppearanceBridge | null;
  readonly avatarPreview?: AgentCenterAvatarPreviewAdapter | null;
  readonly snapshot?: AgentCenterRuntimeSnapshot | null;
  readonly loadPresentation?: () => Promise<{
    readonly profile: NimiRuntimeAgentPresentationProfileProjection | null;
    readonly previousProfile: NimiRuntimeAgentPresentationProfileProjection | null;
    readonly committedRevision: string | null;
  }>;
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
  let committedProfile = input.snapshot?.inspect?.presentationProfile || EMPTY_PROFILE;
  let previousProfile: NimiRuntimeAgentPresentationProfileProjection | null = null;
  let committedRevision = input.snapshot?.inspect?.presentationProfileRevision ?? null;
  let currentMaterialRef: string | null = null;
  let previousMaterialRef: string | null = null;
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

  const adopt = (result: AgentCenterRuntimePresentationProfileMutationResult, materialRef: string | null) => {
    previousProfile = result.previousProfile;
    previousMaterialRef = currentMaterialRef;
    committedProfile = result.profile || EMPTY_PROFILE;
    committedRevision = result.committedRevision;
    currentMaterialRef = materialRef;
  };

  const project = () => projectCommittedAppearance({
    profile: committedProfile,
    previousProfile,
    presentationRevision: committedRevision,
    materialRef: currentMaterialRef,
    avatarPreview: input.avatarPreview || null,
    identity: input.identity,
    accountId: scope().accountId,
    shellAvailable: Boolean(input.shell),
  });

  const refresh = async (): Promise<AgentCenterAppearanceProjection> => {
    if (input.loadPresentation) {
      const projection = await input.loadPresentation();
      committedProfile = projection.profile || EMPTY_PROFILE;
      previousProfile = projection.previousProfile;
      committedRevision = projection.committedRevision;
      if (committedProfile.avatarAssetRef && previousProfile?.avatarAssetRef === committedProfile.avatarAssetRef) {
        currentMaterialRef = previousMaterialRef;
      }
    }
    return project();
  };

  return {
    load: () => enqueue(refresh),
    ...(input.shell ? {
      replaceAvatar(kind: 'live2d' | 'vrm') {
        return enqueue(async () => {
          if (committedRevision === null) {
            throw new Error('Agent Center Runtime presentation revision is unavailable.');
          }
          const material = await input.shell!.pickAvatarAssetMaterial(scope(), kind);
          if (!material) return project();
          if (material.backendKind !== kind) {
            throw new Error('Shell returned appearance material for the wrong backend.');
          }
          const result = await input.runtimePresentation.setPresentationProfile(
            input.identity,
            {
              backendKind: kind,
              defaultVoiceReference: committedProfile.defaultVoiceReference,
              avatarAutoplay: committedProfile.avatarAutoplay,
              backgroundAssetRef: committedProfile.backgroundAssetRef,
            },
            committedRevision,
            [{
              role: material.role,
              fileName: material.fileName,
              mediaType: material.mediaType,
              content: material.content,
              sha256: material.sha256,
            }],
          );
          adopt(result, material.custodyRef);
          return project();
        });
      },
    } : {}),
    async restorePreviousAppearance() {
      return enqueue(async () => {
        if (!previousProfile || committedRevision === null) {
          throw new Error('No previous committed appearance is available to restore.');
        }
        const restored = previousProfile;
        const result = await input.runtimePresentation.setPresentationProfile(
          input.identity,
          restored,
          committedRevision,
        );
        const restoredMaterialRef = previousMaterialRef;
        adopt(result, restoredMaterialRef);
        return project();
      });
    },
  };
}

async function projectCommittedAppearance(input: {
  readonly profile: NimiRuntimeAgentPresentationProfileProjection;
  readonly previousProfile: NimiRuntimeAgentPresentationProfileProjection | null;
  readonly presentationRevision: string | null;
  readonly materialRef: string | null;
  readonly avatarPreview: AgentCenterAvatarPreviewAdapter | null;
  readonly identity: RuntimeLocalAgentIdentityInput;
  readonly accountId: string;
  readonly shellAvailable: boolean;
}): Promise<AgentCenterAppearanceProjection> {
  const avatarAssetRef = input.profile.avatarAssetRef || null;
  const backendKind = input.profile.backendKind;
  const base: AgentCenterAppearanceProjection = {
    status: avatarAssetRef ? 'loading' : 'not_configured',
    presentationRevision: input.presentationRevision,
    backendKind,
    avatarAssetRef,
    avatarAssetValid: Boolean(avatarAssetRef),
    validationStatus: avatarAssetRef ? 'committed' : null,
    backgroundRef: input.profile.backgroundAssetRef,
    defaultVoiceReference: input.profile.defaultVoiceReference,
    avatarAutoplay: input.profile.avatarAutoplay,
    avatarImportDisabled: !input.shellAvailable,
    disabledReasonCode: avatarAssetRef ? null : 'avatar-not-configured',
    disabledReason: avatarAssetRef ? null : 'appearance asset not configured',
    previousSelection: profileIntent(input.previousProfile),
    renderMaterialRef: input.materialRef,
    renderTier: 'avatar_preview_service',
    renderImageRef: null,
    renderVisiblePixels: null,
    renderWarnings: [],
  };
  if (!avatarAssetRef) return base;
  if ((backendKind !== 'live2d' && backendKind !== 'vrm') || !input.avatarPreview || !input.materialRef) {
    return {
      ...base,
      status: 'invalid',
      renderState: 'unavailable',
      renderFailureReason: !input.materialRef
        ? 'Committed appearance material is not available to the Avatar renderer.'
        : 'Avatar committed-effect renderer is unavailable.',
    };
  }
  try {
    const result = await input.avatarPreview.resolvePreview({
      identity: input.identity,
      accountId: input.accountId,
      backendKind,
      avatarAssetRef,
      previewMaterialRef: input.materialRef,
    });
    if (result.state === 'ready') {
      if (result.tier === 'avatar_preview_service'
        && result.nonPlaceholder
        && result.avatarAssetRef === avatarAssetRef
        && result.previewMaterialRef === input.materialRef
        && result.visiblePixels > 0) {
        return {
          ...base,
          status: 'ready',
          renderState: 'ready',
          renderImageRef: result.previewImageRef,
          renderVisiblePixels: result.visiblePixels,
          renderWarnings: result.warnings || [],
          renderFailureReason: null,
        };
      }
      return { ...base, status: 'invalid', renderState: 'failed', renderFailureReason: 'Avatar render evidence did not match the committed appearance.' };
    }
    return {
      ...base,
      status: result.state === 'loading' ? 'loading' : 'invalid',
      renderState: result.state,
      renderFailureReason: result.reason,
      renderWarnings: result.warnings || [],
    };
  } catch (error) {
    return {
      ...base,
      status: 'invalid',
      renderState: 'failed',
      renderFailureReason: error instanceof Error ? error.message : String(error),
    };
  }
}

function profileIntent(
  profile: NimiRuntimeAgentPresentationProfileProjection | null,
): AgentCenterPermissionedPresentationIntent | null {
  if (!profile) return null;
  return {
    backendKind: profile.backendKind,
    avatarAssetReference: profile.avatarAssetRef,
    defaultVoiceReference: profile.defaultVoiceReference,
    avatarAutoplay: profile.avatarAutoplay,
    backgroundAssetReference: profile.backgroundAssetRef,
  };
}

function requireText(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`Agent Center shell appearance adapter requires ${field}.`);
  return text;
}

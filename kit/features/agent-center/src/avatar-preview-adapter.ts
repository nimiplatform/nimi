import type { RuntimeLocalAgentIdentityInput } from '@nimiplatform/kit/core/sdk-contract';
import {
  isAgentCenterAvatarPreviewReady,
  normalizeAgentCenterPreviewRef,
} from './appearance-preview-readiness.js';
import type {
  AgentCenterAppearanceProjection,
  AgentCenterAvatarPreviewAdapter,
} from './types.js';

type PreviewMaterial = {
  readonly avatarAssetRef: string;
  readonly backendKind: string;
  readonly previewMaterialRef: string;
};

export async function resolveAgentCenterAvatarPreviewProjection(input: {
  readonly avatarAssetRef: string | null;
  readonly backendKind: string | null;
  readonly backendCapabilityProfileRef: string | null;
  readonly avatarValidationStatus: string | null;
  readonly material: { readonly result: PreviewMaterial | null; readonly error: string | null } | null;
  readonly avatarPreview: AgentCenterAvatarPreviewAdapter | null;
  readonly identity: RuntimeLocalAgentIdentityInput;
  readonly accountId: string;
}) {
  const base = {
    previewTier: 'avatar_preview_service' as const,
    previewArtifactRef: null,
    previewImageRef: null,
    previewEvidenceRef: null,
    previewVisiblePixels: null,
    previewSampledPixelChecksum: null,
    previewWarnings: [] as readonly string[],
  };
  if (!input.avatarAssetRef) return null;
  if (input.avatarValidationStatus === 'checking') {
    return { ...base, previewState: 'loading' as const, previewFailureReason: 'Avatar asset validation is still checking.' };
  }
  if (input.avatarValidationStatus !== 'valid') {
    return { ...base, previewState: 'failed' as const, previewFailureReason: 'Avatar asset validation is not valid.' };
  }
  if (input.material?.error) {
    return { ...base, previewState: 'failed' as const, previewFailureReason: input.material.error };
  }
  if (!input.material?.result) {
    return { ...base, previewState: 'unavailable' as const, previewFailureReason: 'Shell preview material is unavailable.' };
  }
  if (!input.avatarPreview) {
    return { ...base, previewState: 'unavailable' as const, previewFailureReason: 'Avatar preview service adapter is unavailable.' };
  }
  const backendKind = input.backendKind === 'live2d' || input.backendKind === 'vrm' ? input.backendKind : null;
  if (!backendKind) {
    return { ...base, previewState: 'unavailable' as const, previewFailureReason: 'Selected backend is not admitted for Avatar preview.' };
  }
  if (input.material.result.avatarAssetRef !== input.avatarAssetRef
    || input.material.result.backendKind !== backendKind) {
    return { ...base, previewState: 'failed' as const, previewFailureReason: 'Shell preview material does not match selected avatar.' };
  }
  try {
    const result = await input.avatarPreview.resolvePreview({
      identity: input.identity,
      accountId: input.accountId,
      backendKind,
      avatarAssetRef: input.avatarAssetRef,
      previewMaterialRef: input.material.result.previewMaterialRef,
      backendCapabilityProfileRef: input.backendCapabilityProfileRef,
    });
    if (result.tier !== 'avatar_preview_service') throw new Error('Avatar preview result has the wrong service tier.');
    if (result.state === 'ready') {
      const readyProjection: AgentCenterAppearanceProjection = {
        status: 'invalid',
        avatarAssetValid: true,
        backendKind,
        avatarAssetRef: normalizeAgentCenterPreviewRef(result.avatarAssetRef),
        previewMaterialRef: normalizeAgentCenterPreviewRef(result.previewMaterialRef),
        previewState: 'ready',
        previewTier: result.tier,
        previewArtifactRef: normalizeAgentCenterPreviewRef(result.previewArtifactRef),
        previewImageRef: normalizeAgentCenterPreviewRef(result.previewImageRef),
        previewEvidenceRef: normalizeAgentCenterPreviewRef(result.evidenceRef),
        previewVisiblePixels: result.visiblePixels,
        previewSampledPixelChecksum: result.sampledPixelChecksum,
      };
      if (!result.nonPlaceholder
        || result.backendKind !== backendKind
        || readyProjection.avatarAssetRef !== input.avatarAssetRef
        || readyProjection.previewMaterialRef !== input.material.result.previewMaterialRef
        || !isAgentCenterAvatarPreviewReady(readyProjection)) {
        throw new Error('Avatar preview evidence does not match selected avatar material.');
      }
      return {
        previewState: 'ready' as const,
        previewTier: result.tier,
        previewArtifactRef: readyProjection.previewArtifactRef,
        previewImageRef: readyProjection.previewImageRef,
        previewEvidenceRef: readyProjection.previewEvidenceRef,
        previewVisiblePixels: readyProjection.previewVisiblePixels,
        previewSampledPixelChecksum: readyProjection.previewSampledPixelChecksum,
        previewFailureReason: null,
        previewWarnings: result.warnings ?? [],
      };
    }
    if (result.state !== 'failed' && result.state !== 'unavailable' && result.state !== 'loading') {
      throw new Error('Avatar preview service returned an unknown state.');
    }
    if (result.nonPlaceholder !== false) {
      throw new Error('Non-ready Avatar preview result cannot claim non-placeholder evidence.');
    }
    return {
      ...base,
      previewState: result.state,
      previewFailureReason: requireText(result.reason, 'preview failure reason'),
      previewWarnings: result.warnings ?? [],
    };
  } catch (error) {
    return {
      ...base,
      previewState: 'failed' as const,
      previewFailureReason: error instanceof Error ? error.message : String(error),
    };
  }
}

function requireText(value: unknown, field: string): string {
  const text = normalizeAgentCenterPreviewRef(value);
  if (!text) throw new Error(`Agent Center Avatar preview adapter requires ${field}.`);
  return text;
}

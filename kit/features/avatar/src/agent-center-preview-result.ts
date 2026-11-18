import type { AvatarBackendKind } from './types.js';
import { normalizeAvatarControlledPreviewSurfaceRef } from './preview-surface-ref.js';

export type AgentCenterAvatarPreviewServiceResult =
  | {
      readonly state: 'ready';
      readonly tier: 'avatar_preview_service';
      readonly backendKind: AvatarBackendKind;
      readonly avatarAssetRef: string;
      readonly previewMaterialRef: string;
      readonly previewImageRef: string;
      readonly warnings?: readonly string[];
    }
  | {
      readonly state: 'failed' | 'unavailable' | 'loading';
      readonly tier: 'avatar_preview_service';
      readonly backendKind?: AvatarBackendKind | null;
      readonly avatarAssetRef?: string | null;
      readonly previewMaterialRef?: string | null;
      readonly reason: string;
      readonly warnings?: readonly string[];
    };

export interface ResolveAgentCenterAvatarPreviewServiceInput {
  readonly previewState?: string | null;
  readonly previewTier?: string | null;
  readonly backendKind?: string | null;
  readonly avatarAssetRef?: string | null;
  readonly previewMaterialRef?: string | null;
  readonly previewImageRef?: string | null;
  readonly previewFailureReason?: string | null;
  readonly previewWarnings?: readonly string[];
}

export function resolveAgentCenterAvatarPreviewServiceResult(
  input: ResolveAgentCenterAvatarPreviewServiceInput,
): AgentCenterAvatarPreviewServiceResult {
  const backendKind = normalizeBackendKind(input.backendKind);
  const avatarAssetRef = normalizeText(input.avatarAssetRef);
  const previewMaterialRef = normalizeText(input.previewMaterialRef);
  const previewImageRef = normalizeAvatarControlledPreviewSurfaceRef(input.previewImageRef);
  if (
    input.previewState === 'ready'
    && input.previewTier === 'avatar_preview_service'
    && backendKind
    && avatarAssetRef
    && previewMaterialRef
    && previewImageRef
  ) {
    return {
      state: 'ready',
      tier: 'avatar_preview_service',
      backendKind,
      avatarAssetRef,
      previewMaterialRef,
      previewImageRef,
      warnings: input.previewWarnings ?? [],
    };
  }
  return {
    state: input.previewState === 'loading' ? 'loading' : input.previewState === 'failed' ? 'failed' : 'unavailable',
    tier: 'avatar_preview_service',
    backendKind,
    avatarAssetRef: avatarAssetRef || null,
    previewMaterialRef: previewMaterialRef || null,
    reason: normalizeText(input.previewFailureReason) || 'avatar_preview_service result is not ready',
    warnings: input.previewWarnings ?? [],
  };
}

function normalizeBackendKind(value: unknown): AvatarBackendKind | null {
  const text = normalizeText(value);
  if (text === 'vrm' || text === 'live2d' || text === 'sprite2d' || text === 'canvas2d' || text === 'video') {
    return text;
  }
  return null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

import type { ReactNode } from 'react';
import { AvatarStage } from './components/avatar-stage.js';
import { createAvatarStageSnapshot } from './headless.js';
import type {
  AvatarBackendKind,
  AvatarStageSize,
} from './types.js';

export type AgentCenterAvatarPreviewServiceResult =
  | {
      readonly state: 'ready';
      readonly tier: 'avatar_preview_service';
      readonly backendKind: AvatarBackendKind;
      readonly avatarAssetRef: string;
      readonly previewArtifactRef: string;
      readonly previewImageRef: string;
      readonly evidenceRef: string;
      readonly visiblePixels: number;
      readonly sampledPixelChecksum: number;
      readonly nonPlaceholder: true;
      readonly warnings?: readonly string[];
    }
  | {
      readonly state: 'failed' | 'unavailable' | 'loading';
      readonly tier: 'avatar_preview_service';
      readonly backendKind?: AvatarBackendKind | null;
      readonly avatarAssetRef?: string | null;
      readonly previewArtifactRef?: string | null;
      readonly evidenceRef?: string | null;
      readonly nonPlaceholder: false;
      readonly reason: string;
      readonly warnings?: readonly string[];
    };

export interface ResolveAgentCenterAvatarPreviewServiceInput {
  readonly previewState?: string | null;
  readonly previewTier?: string | null;
  readonly backendKind?: string | null;
  readonly avatarAssetRef?: string | null;
  readonly previewMaterialRef?: string | null;
  readonly previewArtifactRef?: string | null;
  readonly previewImageRef?: string | null;
  readonly previewEvidenceRef?: string | null;
  readonly previewVisiblePixels?: number | null;
  readonly previewSampledPixelChecksum?: number | null;
  readonly previewFailureReason?: string | null;
  readonly previewWarnings?: readonly string[];
}

export function resolveAgentCenterAvatarPreviewServiceResult(
  input: ResolveAgentCenterAvatarPreviewServiceInput,
): AgentCenterAvatarPreviewServiceResult {
  const backendKind = normalizeBackendKind(input.backendKind);
  const avatarAssetRef = normalizeText(input.avatarAssetRef);
  const previewMaterialRef = normalizeText(input.previewMaterialRef);
  const previewArtifactRef = normalizeText(input.previewArtifactRef);
  const previewImageRef = normalizePreviewSurfaceRef(input.previewImageRef);
  const evidenceRef = normalizeText(input.previewEvidenceRef);
  const visiblePixels = normalizePositiveNumber(input.previewVisiblePixels);
  const sampledPixelChecksum = normalizeFiniteNumber(input.previewSampledPixelChecksum);
  if (
    input.previewState === 'ready'
    && input.previewTier === 'avatar_preview_service'
    && backendKind
    && avatarAssetRef
    && previewMaterialRef
    && previewArtifactRef
    && previewArtifactRef !== previewMaterialRef
    && isAvatarOwnedArtifactRef(backendKind, previewArtifactRef)
    && previewImageRef
    && evidenceRef
    && isAvatarOwnedEvidenceRef(backendKind, evidenceRef)
    && visiblePixels !== null
    && sampledPixelChecksum !== null
  ) {
    return {
      state: 'ready',
      tier: 'avatar_preview_service',
      backendKind,
      avatarAssetRef,
      previewArtifactRef,
      previewImageRef,
      evidenceRef,
      visiblePixels,
      sampledPixelChecksum,
      nonPlaceholder: true,
      warnings: input.previewWarnings ?? [],
    };
  }
  return {
    state: input.previewState === 'loading' ? 'loading' : input.previewState === 'failed' ? 'failed' : 'unavailable',
    tier: 'avatar_preview_service',
    backendKind,
    avatarAssetRef: avatarAssetRef || null,
    previewArtifactRef: previewArtifactRef || null,
    evidenceRef: null,
    nonPlaceholder: false,
    reason: normalizeText(input.previewFailureReason) || 'avatar_preview_service result is not ready',
    warnings: input.previewWarnings ?? [],
  };
}

export interface AgentCenterAvatarPreviewProps {
  readonly result: AgentCenterAvatarPreviewServiceResult;
  readonly label: string;
  readonly size?: AvatarStageSize;
  readonly className?: string;
  readonly fallback?: ReactNode;
}

export function AgentCenterAvatarPreview({
  result,
  label,
  size = 'lg',
  className,
  fallback = null,
}: AgentCenterAvatarPreviewProps) {
  if (result.state !== 'ready') {
    return (
      <div
        className={className}
        data-avatar-preview-state={result.state}
        data-avatar-preview-tier="avatar_preview_service"
        data-avatar-preview-nonplaceholder="false"
        data-avatar-preview-reason={result.reason}
      >
        {fallback}
      </div>
    );
  }
  return (
    <div
      className={className}
      data-avatar-preview-state="ready"
      data-avatar-preview-tier={result.tier}
      data-avatar-preview-backend-kind={result.backendKind}
      data-avatar-preview-artifact-ref={result.previewArtifactRef}
      data-avatar-preview-evidence-ref={result.evidenceRef}
      data-avatar-preview-visible-pixels={result.visiblePixels}
      data-avatar-preview-sampled-pixel-checksum={result.sampledPixelChecksum}
      data-avatar-preview-nonplaceholder="true"
    >
      <AvatarStage
        imageUrl={result.previewImageRef}
        label={label}
        showStatusBadge={false}
        size={size}
        snapshot={createAvatarStageSnapshot({
          backendKind: result.backendKind,
          avatarAssetRef: result.avatarAssetRef,
          expressionProfileRef: null,
          idlePreset: null,
          interactionPolicyRef: null,
          defaultVoiceReference: null,
        })}
      />
    </div>
  );
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

function normalizePreviewSurfaceRef(value: unknown): string {
  const text = normalizeText(value);
  if (text.startsWith('/') && !text.startsWith('//') && !text.includes('\\')) return text;
  if (text.startsWith('blob:')) {
    const currentOrigin = normalizeText(globalThis.location?.origin);
    if (!currentOrigin || currentOrigin === 'null') return '';
    try {
      return new URL(text.slice('blob:'.length)).origin === currentOrigin ? text : '';
    } catch {
      return '';
    }
  }
  return '';
}

function isAvatarOwnedArtifactRef(backendKind: AvatarBackendKind, value: string): boolean {
  return value.startsWith(backendKind === 'vrm'
    ? 'avatar.vrm.preview-artifact:'
    : 'avatar.carrier.preview-artifact:');
}

function isAvatarOwnedEvidenceRef(backendKind: AvatarBackendKind, value: string): boolean {
  return value.startsWith(backendKind === 'vrm'
    ? 'avatar.vrm.visual:'
    : 'avatar.carrier.visual:');
}

function normalizePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

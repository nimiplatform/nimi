import type { ReactNode } from 'react';
import { AvatarStage } from './components/avatar-stage.js';
import { createAvatarStageSnapshot } from './headless.js';
import { normalizeAvatarControlledPreviewSurfaceRef } from './preview-surface-ref.js';
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
      readonly previewImageRef: string;
      readonly visiblePixels: number;
      readonly nonPlaceholder: true;
      readonly warnings?: readonly string[];
    }
  | {
      readonly state: 'failed' | 'unavailable' | 'loading';
      readonly tier: 'avatar_preview_service';
      readonly backendKind?: AvatarBackendKind | null;
      readonly avatarAssetRef?: string | null;
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
  readonly previewImageRef?: string | null;
  readonly previewVisiblePixels?: number | null;
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
  const visiblePixels = normalizePositiveNumber(input.previewVisiblePixels);
  if (
    input.previewState === 'ready'
    && input.previewTier === 'avatar_preview_service'
    && backendKind
    && avatarAssetRef
    && previewMaterialRef
    && previewImageRef
    && visiblePixels !== null
  ) {
    return {
      state: 'ready',
      tier: 'avatar_preview_service',
      backendKind,
      avatarAssetRef,
      previewImageRef,
      visiblePixels,
      nonPlaceholder: true,
      warnings: input.previewWarnings ?? [],
    };
  }
  return {
    state: input.previewState === 'loading' ? 'loading' : input.previewState === 'failed' ? 'failed' : 'unavailable',
    tier: 'avatar_preview_service',
    backendKind,
    avatarAssetRef: avatarAssetRef || null,
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
      data-avatar-preview-visible-pixels={result.visiblePixels}
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

function normalizePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

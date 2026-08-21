import { Suspense, lazy, useMemo, useState, type CSSProperties, type ComponentType, type ErrorInfo, type ReactNode } from 'react';

import { cn } from '@nimiplatform/kit/ui';

import { AvatarViewportFailureSurface, renderAvatarPlaceholderSurface } from './placeholder-surface.js';
import { AvatarViewportErrorBoundary } from './viewport-error-boundary.js';
import type {
  AvatarStageBackendRenderer,
  AvatarStageRendererContext,
  AvatarStageSnapshot,
} from './types.js';
export { formatAvatarVrmAssetLabel } from './asset-label.js';
export {
  DEFAULT_AVATAR_PHASE_LABELS,
  resolveAvatarPhaseLabel,
} from './phase-label.js';
export type {
  AvatarPhaseLabelOverrides,
  AvatarPhaseLabels,
} from './phase-label.js';
export type {
  AvatarAttentionState,
  AvatarVrmExpressionWeights,
  AvatarVrmFramingIntent,
  AvatarVrmFramingMetrics,
  AvatarVrmFramingPolicy,
  AvatarVrmFramingResult,
  AvatarVrmViewportState,
  VrmCameraFramingInput,
  VrmCameraFramingIntent,
  VrmCameraFramingResult,
  VrmCameraFramingVector,
  CreateVrmEmoteStateInputs,
  VrmEmoteBundle,
  VrmEmoteSnapshot,
  VrmEmoteState,
  VrmEmoteTable,
  VrmExpressionWritable,
  VrmMotionPresetEntry,
  VrmMotionPresetTable,
} from './vrm-domain.js';
export {
  ADMITTED_INTERCHANGE_PRESET_IDS,
  computeVrmCameraFraming,
  createVrmEmoteState,
  DEFAULT_TRANSIENT_FADE_SEC,
  measureAvatarVrmFramingMetrics,
  normalizeVrmEmoteTable,
  normalizeVrmMotionPresetTable,
  PRIMARY_EXPRESSION_WEIGHT_CAP,
  resolveAvatarVrmExpressionWeights,
  resolveAvatarVrmFramingFromScene,
  resolveAvatarVrmFramingPolicy,
  resolveAvatarVrmFramingResult,
  resolveAvatarVrmViewportState,
  VISEME_NAMES,
} from './vrm-domain.js';

export type AvatarVrmViewportRenderInput = {
  label: string;
  assetRef: string;
  posterUrl: string | null;
  idlePreset: string | null;
  expressionProfileRef: string | null;
  interactionPolicyRef: string | null;
  defaultVoiceReference: string | null;
  snapshot: AvatarStageSnapshot;
  style?: CSSProperties;
};

export type AvatarVrmViewportRenderer = (
  input: AvatarVrmViewportRenderInput,
) => ReactNode;

export type AvatarVrmViewportComponentProps = {
  input: AvatarVrmViewportRenderInput;
  chrome?: 'default' | 'minimal';
};

export type AvatarVrmViewportComponent = ComponentType<AvatarVrmViewportComponentProps>;

export type CreateVrmAvatarRendererOptions = {
  renderViewport?: AvatarVrmViewportRenderer;
  className?: string;
};

export type LoadAvatarVrmViewportComponent = () => Promise<{
  default: AvatarVrmViewportComponent;
}>;

export type CreateLazyVrmAvatarRendererOptions = {
  loadViewport: LoadAvatarVrmViewportComponent;
  loadingFallback?: ReactNode;
  viewportErrorLabel?: string;
  retryViewportLabel?: string;
  onViewportError?: (error: Error, info: ErrorInfo) => void;
  className?: string;
};

export function createAvatarVrmViewportRenderInput(
  context: AvatarStageRendererContext,
): AvatarVrmViewportRenderInput {
  return {
    label: context.label,
    assetRef: context.snapshot.presentation.avatarAssetRef,
    posterUrl: context.renderer.posterUrl,
    idlePreset: context.snapshot.presentation.idlePreset || null,
    expressionProfileRef: context.snapshot.presentation.expressionProfileRef || null,
    interactionPolicyRef: context.snapshot.presentation.interactionPolicyRef || null,
    defaultVoiceReference: context.snapshot.presentation.defaultVoiceReference || null,
    snapshot: context.snapshot,
    style: context.style,
  };
}

export function createVrmAvatarRenderer(
  options: CreateVrmAvatarRendererOptions = {},
): AvatarStageBackendRenderer {
  return (context) => {
    const viewportInput = createAvatarVrmViewportRenderInput(context);
    const viewport = options.renderViewport
      ? options.renderViewport(viewportInput)
      : null;
    if (viewport) {
      return (
        <div className={cn('relative flex h-full w-full items-center justify-center overflow-hidden', options.className)}>
          {viewport}
        </div>
      );
    }
    return renderAvatarPlaceholderSurface(context);
  };
}

function LazyVrmAvatarSurface({
  context,
  options,
}: {
  context: AvatarStageRendererContext;
  options: CreateLazyVrmAvatarRendererOptions;
}) {
  const [attempt, setAttempt] = useState(0);
  const LazyViewport = useMemo(() => lazy(options.loadViewport), [attempt, options.loadViewport]);
  const viewportInput = createAvatarVrmViewportRenderInput(context);
  return (
    <div className={cn('relative flex h-full w-full items-center justify-center overflow-hidden', options.className)}>
      <AvatarViewportErrorBoundary
        resetKey={`${context.snapshot.presentation.avatarAssetRef}:${attempt}`}
        onError={options.onViewportError}
        fallback={(
          <AvatarViewportFailureSurface
            context={context}
            errorLabel={options.viewportErrorLabel}
            retryLabel={options.retryViewportLabel}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        )}
      >
        <Suspense fallback={options.loadingFallback ?? renderAvatarPlaceholderSurface(context)}>
          <LazyViewport input={viewportInput} />
        </Suspense>
      </AvatarViewportErrorBoundary>
    </div>
  );
}

export function createLazyVrmAvatarRenderer(
  options: CreateLazyVrmAvatarRendererOptions,
): AvatarStageBackendRenderer {
  return (context) => <LazyVrmAvatarSurface context={context} options={options} />;
}

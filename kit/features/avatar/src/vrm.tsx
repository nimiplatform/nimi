import { Suspense, lazy, type CSSProperties, type ComponentType, type ReactNode } from 'react';

import { cn } from '@nimiplatform/nimi-kit/ui';

import type {
  AvatarStageBackendRenderer,
  AvatarStageRendererContext,
  AvatarStageSnapshot,
} from './types.js';

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
  className?: string;
};

export function formatAvatarVrmAssetLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('fallback://')) {
    return normalized.replace('fallback://', '');
  }
  const segments = normalized.split('/');
  return segments[segments.length - 1] || normalized;
}

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

function renderDefaultVrmSurface(context: AvatarStageRendererContext): ReactNode {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.98),rgba(226,232,240,0.95)_55%,rgba(203,213,225,0.85))]">
      {context.renderer.posterUrl ? (
        <img
          src={context.renderer.posterUrl}
          alt={context.label}
          className="absolute inset-0 h-full w-full object-cover opacity-30"
        />
      ) : null}
      <span className="absolute inset-[16%] rounded-full border border-white/70 bg-[radial-gradient(circle,rgba(255,255,255,0.92),rgba(226,232,240,0.7))]" />
      <span className="absolute inset-x-[30%] bottom-[18%] top-[24%] rounded-[999px_999px_40%_40%] border border-slate-400/25 bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(226,232,240,0.58))] shadow-[0_18px_36px_rgba(15,23,42,0.08)]" />
      <span className="absolute inset-x-[23%] top-[14%] h-[42%] rounded-[50%_50%_42%_42%] border border-slate-400/25 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(226,232,240,0.72))]" />
      <span className="absolute bottom-3 rounded-full border border-white/70 bg-slate-900/84 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
        {formatAvatarVrmAssetLabel(context.snapshot.presentation.avatarAssetRef) || 'avatar.vrm'}
      </span>
    </div>
  );
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
    return renderDefaultVrmSurface(context);
  };
}

export function createLazyVrmAvatarRenderer(
  options: CreateLazyVrmAvatarRendererOptions,
): AvatarStageBackendRenderer {
  const LazyViewport = lazy(options.loadViewport);
  return (context) => {
    const viewportInput = createAvatarVrmViewportRenderInput(context);
    return (
      <div className={cn('relative flex h-full w-full items-center justify-center overflow-hidden', options.className)}>
        <Suspense fallback={options.loadingFallback ?? renderDefaultVrmSurface(context)}>
          <LazyViewport input={viewportInput} />
        </Suspense>
      </div>
    );
  };
}

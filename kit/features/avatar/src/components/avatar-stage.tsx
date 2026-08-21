import { useState, type CSSProperties, type ReactNode } from 'react';
import { cn, Surface } from '@nimiplatform/kit/ui';
import {
  inferAvatarEmotionFromPhase,
  inferAvatarToneFromEmotion,
  resolveAvatarStageBackendRenderer,
  resolveAvatarStageRendererModel,
} from '../headless.js';
import { createLive2dAvatarRenderer } from '../live2d.js';
import {
  resolveAvatarPhaseLabel,
  type AvatarPhaseLabelOverrides,
} from '../phase-label.js';
import { createVrmAvatarRenderer } from '../vrm.js';
import type {
  AvatarBackendKind,
  AvatarStageBackendRenderer,
  AvatarStageRendererContext,
  AvatarStageRendererRegistry,
  AvatarStageSize,
  AvatarStageSnapshot,
  AvatarStageTone,
} from '../types.js';

export type { AvatarPhaseLabelOverrides };

export type AvatarStageProps = {
  snapshot: AvatarStageSnapshot;
  label: string;
  imageUrl?: string | null;
  fallbackLabel?: string | null;
  statusLabel?: ReactNode;
  showStatusBadge?: boolean;
  tone?: AvatarStageTone;
  size?: AvatarStageSize;
  className?: string;
  style?: CSSProperties;
  fallback?: ReactNode;
  renderers?: AvatarStageRendererRegistry;
  labels?: AvatarPhaseLabelOverrides;
};

// aura/ring derive from the admitted --nimi-status-* tokens via color-mix
// (tone semantics: mint→success, sky→info, amber→warning, rose→danger,
// slate→neutral); per-tone alpha tuning is preserved. `badge` uses the
// admitted --nimi-status-*-soft-* trio, mirroring kit/ui InlineAlert.
const TONE_STYLES: Record<AvatarStageTone, { aura: string; ring: string; badge: string }> = {
  mint: {
    aura: 'color-mix(in srgb, var(--nimi-status-success) 28%, transparent)',
    ring: 'color-mix(in srgb, var(--nimi-status-success) 30%, transparent)',
    badge: 'border-[var(--nimi-status-success-soft-border)] bg-[var(--nimi-status-success-soft-bg)] text-[color:var(--nimi-status-success-soft-text)]',
  },
  sky: {
    aura: 'color-mix(in srgb, var(--nimi-status-info) 26%, transparent)',
    ring: 'color-mix(in srgb, var(--nimi-status-info) 30%, transparent)',
    badge: 'border-[var(--nimi-status-info-soft-border)] bg-[var(--nimi-status-info-soft-bg)] text-[color:var(--nimi-status-info-soft-text)]',
  },
  amber: {
    aura: 'color-mix(in srgb, var(--nimi-status-warning) 28%, transparent)',
    ring: 'color-mix(in srgb, var(--nimi-status-warning) 30%, transparent)',
    badge: 'border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-status-warning-soft-bg)] text-[color:var(--nimi-status-warning-soft-text)]',
  },
  rose: {
    aura: 'color-mix(in srgb, var(--nimi-status-danger) 24%, transparent)',
    ring: 'color-mix(in srgb, var(--nimi-status-danger) 28%, transparent)',
    badge: 'border-[var(--nimi-status-danger-soft-border)] bg-[var(--nimi-status-danger-soft-bg)] text-[color:var(--nimi-status-danger-soft-text)]',
  },
  slate: {
    aura: 'color-mix(in srgb, var(--nimi-status-neutral) 22%, transparent)',
    ring: 'color-mix(in srgb, var(--nimi-status-neutral) 28%, transparent)',
    badge: 'border-[var(--nimi-status-neutral-soft-border)] bg-[var(--nimi-status-neutral-soft-bg)] text-[color:var(--nimi-status-neutral-soft-text)]',
  },
};

const SIZE_CLASSES: Record<NonNullable<AvatarStageProps['size']>, { frame: string; avatar: 'sm' | 'md' | 'lg'; title: string; badge: string }> = {
  sm: {
    frame: 'h-24 w-24',
    avatar: 'lg',
    title: 'text-xs',
    badge: 'px-2.5 py-1 text-[length:var(--nimi-type-overline-size)]',
  },
  md: {
    frame: 'h-28 w-28',
    avatar: 'lg',
    title: 'text-sm',
    badge: 'px-3 py-1.5 text-[length:var(--nimi-type-overline-size)]',
  },
  lg: {
    frame: 'h-44 w-44',
    avatar: 'lg',
    title: 'text-sm',
    badge: 'px-3.5 py-2 text-xs',
  },
};

function StaticMediaSurface({ context }: { context: AvatarStageRendererContext }) {
  const imageUrl = context.renderer.mediaUrl || context.renderer.posterUrl;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const mediaFailed = imageUrl !== null && failedUrl === imageUrl;
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,var(--nimi-surface-card),var(--nimi-surface-panel)_55%,var(--nimi-surface-canvas))]">
      {context.renderer.kind === 'video' && imageUrl && !mediaFailed ? (
        <video
          src={imageUrl}
          className="absolute inset-0 h-full w-full object-cover"
          muted
          loop
          playsInline
          autoPlay
          aria-hidden="true"
          onError={() => setFailedUrl(imageUrl)}
        />
      ) : imageUrl && !mediaFailed ? (
        <img
          src={imageUrl}
          alt={context.label}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailedUrl(imageUrl)}
        />
      ) : (
        <span className="text-2xl font-semibold text-[color:var(--nimi-text-muted)]">{context.fallback}</span>
      )}
    </div>
  );
}

function renderStaticMediaSurface(context: AvatarStageRendererContext): ReactNode {
  return <StaticMediaSurface context={context} />;
}

const DEFAULT_RENDERERS: Record<AvatarBackendKind, AvatarStageBackendRenderer> = {
  vrm: createVrmAvatarRenderer(),
  live2d: createLive2dAvatarRenderer(),
  sprite2d: renderStaticMediaSurface,
  canvas2d: renderStaticMediaSurface,
  video: renderStaticMediaSurface,
};

export function AvatarStage({
  snapshot,
  label,
  imageUrl,
  fallbackLabel,
  statusLabel,
  showStatusBadge = true,
  tone,
  size = 'md',
  className,
  style,
  fallback = null,
  renderers,
  labels,
}: AvatarStageProps) {
  const emotion = snapshot.interaction.emotion ?? inferAvatarEmotionFromPhase(snapshot.interaction.phase);
  const resolvedTone = tone ?? inferAvatarToneFromEmotion(emotion);
  const toneStyle = TONE_STYLES[resolvedTone];
  const sizeClass = SIZE_CLASSES[size];
  const renderer = resolveAvatarStageRendererModel({
    presentation: snapshot.presentation,
    imageUrl,
  });
  const renderBackend = resolveAvatarStageBackendRenderer({
    backendKind: renderer.kind,
    renderers,
    defaults: DEFAULT_RENDERERS,
  });
  const amplitude = typeof snapshot.interaction.amplitude === 'number' ? Math.max(0, Math.min(snapshot.interaction.amplitude, 1)) : 0;
  const phase = snapshot.interaction.phase;
  const speakingScale = phase === 'speaking' || renderer.prefersMotion ? 1 + amplitude * 0.06 : 1;
  const badgeLabel = statusLabel ?? snapshot.interaction.actionCue ?? resolveAvatarPhaseLabel(phase, labels);
  const resolvedFallback = fallback ?? (((fallbackLabel || label).trim().charAt(0).toUpperCase()) || '?');

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{
        ...style,
      }}
      data-avatar-backend-kind={snapshot.presentation.backendKind}
      data-avatar-phase={phase}
      data-avatar-emotion={emotion ?? 'neutral'}
      data-avatar-renderer={renderer.kind}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-[-24px] rounded-full"
        style={{ background: `radial-gradient(circle, ${toneStyle.aura}, transparent 68%)` }}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-[-10px] rounded-full border transition-[opacity,transform] duration-[var(--nimi-motion-slow)] ease-[var(--nimi-motion-ease-standard)]',
          phase === 'thinking' || phase === 'listening' || phase === 'speaking' ? 'animate-pulse motion-reduce:animate-none' : '',
        )}
        style={{
          borderColor: toneStyle.ring,
          transform: `scale(${speakingScale})`,
          opacity: phase === 'idle' ? 0.78 : 1,
        }}
      />
      {(phase === 'listening' || phase === 'speaking') ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[-18px] rounded-full border"
          style={{
            borderColor: toneStyle.ring,
            opacity: phase === 'speaking' ? 0.55 + amplitude * 0.25 : 0.45,
            transform: `scale(${phase === 'speaking' ? 1.08 + amplitude * 0.08 : 1.05})`,
          }}
        />
      ) : null}
      <Surface
        tone="card"
        elevation="floating"
        padding="none"
        material="glass-chrome"
        className={cn(
          'relative flex items-center justify-center overflow-hidden rounded-full',
          sizeClass.frame,
        )}
        style={{
          transform: `scale(${speakingScale})`,
        }}
      >
        {renderBackend({
          snapshot,
          label,
          fallback: resolvedFallback,
          renderer,
          size,
          frameClassName: sizeClass.frame,
          style,
        })}
      </Surface>
      {showStatusBadge && badgeLabel ? (
        <span
          data-avatar-stage-status-badge="true"
          className={cn(
            'absolute bottom-[-10px] left-1/2 inline-flex max-w-[calc(100%+2rem)] min-w-0 -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold shadow-[0_10px_24px_color-mix(in_srgb,var(--nimi-text-primary)_8%,transparent)]',
            toneStyle.badge,
            sizeClass.badge,
          )}
        >
          <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full bg-current opacity-70', phase === 'thinking' || phase === 'speaking' ? 'animate-pulse motion-reduce:animate-none' : '')} />
          <span data-avatar-stage-status-label="true" className={cn(sizeClass.title, 'min-w-0 truncate leading-none')}>{badgeLabel}</span>
        </span>
      ) : null}
    </div>
  );
}

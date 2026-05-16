import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import {
  inferAvatarEmotionFromPhase,
  inferAvatarToneFromEmotion,
  resolveAvatarStageBackendRenderer,
  resolveAvatarStageRendererModel,
} from '../headless.js';
import { createLive2dAvatarRenderer } from '../live2d.js';
import { createVrmAvatarRenderer } from '../vrm.js';
import type {
  AvatarStageBackendRenderer,
  AvatarStageRendererRegistry,
  AvatarStageSize,
  AvatarStageSnapshot,
  AvatarStageTone,
} from '../types.js';

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
};

const TONE_STYLES: Record<AvatarStageTone, { aura: string; ring: string; border: string; badge: string }> = {
  mint: {
    aura: 'rgba(52, 211, 153, 0.28)',
    ring: 'rgba(16, 185, 129, 0.30)',
    border: 'rgba(255,255,255,0.84)',
    badge: 'border-emerald-200/80 bg-white/90 text-emerald-800',
  },
  sky: {
    aura: 'rgba(56, 189, 248, 0.26)',
    ring: 'rgba(14, 165, 233, 0.30)',
    border: 'rgba(255,255,255,0.84)',
    badge: 'border-sky-200/80 bg-white/90 text-sky-800',
  },
  amber: {
    aura: 'rgba(251, 191, 36, 0.28)',
    ring: 'rgba(245, 158, 11, 0.30)',
    border: 'rgba(255,255,255,0.84)',
    badge: 'border-amber-200/80 bg-white/90 text-amber-800',
  },
  rose: {
    aura: 'rgba(251, 113, 133, 0.24)',
    ring: 'rgba(244, 63, 94, 0.28)',
    border: 'rgba(255,255,255,0.84)',
    badge: 'border-rose-200/80 bg-white/90 text-rose-800',
  },
  slate: {
    aura: 'rgba(148, 163, 184, 0.22)',
    ring: 'rgba(100, 116, 139, 0.28)',
    border: 'rgba(255,255,255,0.84)',
    badge: 'border-slate-200/80 bg-white/90 text-slate-700',
  },
};

const SIZE_CLASSES: Record<NonNullable<AvatarStageProps['size']>, { frame: string; avatar: 'sm' | 'md' | 'lg'; title: string; badge: string }> = {
  sm: {
    frame: 'h-24 w-24',
    avatar: 'lg',
    title: 'text-xs',
    badge: 'px-2.5 py-1 text-[10px]',
  },
  md: {
    frame: 'h-28 w-28',
    avatar: 'lg',
    title: 'text-sm',
    badge: 'px-3 py-1.5 text-[11px]',
  },
  lg: {
    frame: 'h-44 w-44',
    avatar: 'lg',
    title: 'text-sm',
    badge: 'px-3.5 py-2 text-xs',
  },
};

function phaseLabel(phase: AvatarStageSnapshot['interaction']['phase']): string {
  switch (phase) {
    case 'thinking':
      return 'Thinking';
    case 'listening':
      return 'Listening';
    case 'speaking':
      return 'Speaking';
    case 'transitioning':
      return 'Transitioning';
    case 'idle':
    default:
      return 'Idle';
  }
}

const DEFAULT_RENDERERS: Record<'vrm' | 'live2d', AvatarStageBackendRenderer> = {
  vrm: createVrmAvatarRenderer(),
  live2d: createLive2dAvatarRenderer(),
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
  const badgeLabel = statusLabel ?? snapshot.interaction.actionCue ?? phaseLabel(phase);
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
        className="pointer-events-none absolute inset-[-24px] rounded-full blur-3xl transition-all duration-300"
        style={{ background: `radial-gradient(circle, ${toneStyle.aura}, transparent 68%)` }}
      />
      <span
        className={cn(
          'pointer-events-none absolute inset-[-10px] rounded-full border transition-all duration-300',
          phase === 'thinking' || phase === 'listening' || phase === 'speaking' ? 'animate-pulse' : '',
        )}
        style={{
          borderColor: toneStyle.ring,
          transform: `scale(${speakingScale})`,
          opacity: phase === 'idle' ? 0.78 : 1,
        }}
      />
      {(phase === 'listening' || phase === 'speaking') ? (
        <span
          className="pointer-events-none absolute inset-[-18px] rounded-full border"
          style={{
            borderColor: toneStyle.ring,
            opacity: phase === 'speaking' ? 0.55 + amplitude * 0.25 : 0.45,
            transform: `scale(${phase === 'speaking' ? 1.08 + amplitude * 0.08 : 1.05})`,
          }}
        />
      ) : null}
      <div
        className={cn(
          'relative flex items-center justify-center overflow-hidden rounded-full border bg-white/86 shadow-[0_18px_48px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-all duration-300',
          sizeClass.frame,
        )}
        style={{
          borderColor: toneStyle.border,
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
      </div>
      {showStatusBadge && badgeLabel ? (
        <span
          className={cn(
            'absolute bottom-[-10px] left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border font-semibold shadow-[0_10px_24px_rgba(15,23,42,0.08)]',
            toneStyle.badge,
            sizeClass.badge,
          )}
        >
          <span className={cn('inline-block h-2 w-2 rounded-full bg-current opacity-70', phase === 'thinking' || phase === 'speaking' ? 'animate-pulse' : '')} />
          <span className={sizeClass.title}>{badgeLabel}</span>
        </span>
      ) : null}
    </div>
  );
}

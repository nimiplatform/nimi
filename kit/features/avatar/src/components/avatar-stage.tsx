import type { CSSProperties, ReactNode } from 'react';
import { Avatar, cn } from '@nimiplatform/nimi-kit/ui';
import {
  inferAvatarEmotionFromPhase,
  inferAvatarToneFromEmotion,
  resolveAvatarStageBackendRenderer,
  resolveAvatarStageRendererModel,
} from '../headless.js';
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

const renderSpriteAvatarStage: AvatarStageBackendRenderer = ({ fallback, label, renderer, size }) => (
  <Avatar
    src={renderer.mediaUrl}
    alt={label}
    size={SIZE_CLASSES[size].avatar}
    tone="neutral"
    className="h-full w-full bg-transparent text-slate-900"
    fallback={fallback}
    fallbackClassName="bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(241,245,249,0.92))] text-slate-900 text-[1.75em] font-black"
  />
);

const renderVideoAvatarStage: AvatarStageBackendRenderer = ({ label, renderer }) => (
  renderer.mediaUrl ? (
    <video
      className="h-full w-full object-cover"
      src={renderer.mediaUrl}
      poster={renderer.posterUrl || undefined}
      aria-label={label}
      autoPlay
      loop
      muted
      playsInline
    />
  ) : null
);

const renderCanvasAvatarStage: AvatarStageBackendRenderer = ({ fallback, snapshot }) => (
  <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.98),rgba(236,253,245,0.9)_48%,rgba(191,219,254,0.82))]">
    <span className="absolute inset-0 opacity-80 [background-image:linear-gradient(rgba(255,255,255,0.38)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.38)_1px,transparent_1px)] [background-size:18px_18px]" />
    <span className="absolute inset-[18%] rounded-full border border-white/70 bg-[radial-gradient(circle,rgba(255,255,255,0.9),rgba(240,249,255,0.42))]" />
    <span
      className={cn(
        'absolute h-[52%] w-[52%] rounded-full border border-white/80 bg-[radial-gradient(circle,rgba(255,255,255,0.98),rgba(224,231,255,0.72))] shadow-[0_18px_40px_rgba(15,23,42,0.08)]',
        snapshot.interaction.phase === 'thinking' || snapshot.interaction.phase === 'speaking' ? 'animate-pulse' : '',
      )}
    />
    <span className="relative text-[1.9rem] font-black text-slate-900">{fallback}</span>
  </div>
);

const DEFAULT_RENDERERS: Record<'sprite2d' | 'video' | 'vrm' | 'canvas2d', AvatarStageBackendRenderer> = {
  sprite2d: renderSpriteAvatarStage,
  video: renderVideoAvatarStage,
  vrm: createVrmAvatarRenderer(),
  canvas2d: renderCanvasAvatarStage,
};

export function AvatarStage({
  snapshot,
  label,
  imageUrl,
  fallbackLabel,
  statusLabel,
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
      <span className="absolute right-1 top-1 inline-flex rounded-full border border-white/70 bg-slate-950/72 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-white shadow-[0_6px_18px_rgba(15,23,42,0.18)]">
        {renderer.backendLabel}
      </span>
      {badgeLabel ? (
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

import { Suspense, lazy, type ComponentType, type ReactNode } from 'react';

import { cn } from '@nimiplatform/nimi-kit/ui';

import type { AvatarStageBackendRenderer, AvatarStageRendererContext } from './types.js';
import {
  createAvatarVrmViewportRenderInput,
  formatAvatarVrmAssetLabel,
  type AvatarVrmViewportRenderInput,
} from './vrm.js';

export type AvatarLive2dFramingIntent = 'auto' | 'chat-focus' | 'scene-presence' | 'bottom-companion' | 'showcase';

export type AvatarLive2dFramingInput = {
  railWidth: number;
  railHeight: number;
  modelCanvasWidth: number | null;
  modelCanvasHeight: number | null;
  layout: ReadonlyMap<string, number>;
  intent?: AvatarLive2dFramingIntent;
};

export type AvatarLive2dFramingPolicy = {
  mode: 'layout' | 'full-body-tall' | 'upper-body-portrait' | 'wide-in-portrait' | 'default' | 'chat-focus';
  height?: number;
  width?: number;
  centerX?: number;
  centerY?: number;
};

export type AvatarLive2dViewportRenderInput = AvatarVrmViewportRenderInput;

export type AvatarLive2dViewportState = {
  phase: AvatarLive2dViewportRenderInput['snapshot']['interaction']['phase'];
  emotion: NonNullable<AvatarLive2dViewportRenderInput['snapshot']['interaction']['emotion']> | 'neutral';
  amplitude: number;
  badgeLabel: string;
  assetLabel: string;
  motionSpeed: number;
  accentColor: string;
  glowColor: string;
};

export type AvatarLive2dMotionSelection = {
  group: string | null;
  source: 'speech' | 'emotion' | 'idle' | 'fallback-nonidle' | 'fallback-any' | 'ambient-only';
  priority: number;
  downgrade:
    | 'none'
    | 'emotion-to-idle'
    | 'emotion-to-any'
    | 'emotion-to-ambient';
};

export type AvatarLive2dRenderMotionPose = {
  smoothedAmplitude: number;
  speakingEnergy: number;
  scale: number;
  swayX: number;
  swayY: number;
};

export type AvatarLive2dViewportComponentProps = {
  input: AvatarLive2dViewportRenderInput;
  chrome?: 'default' | 'minimal';
};

export type AvatarLive2dViewportComponent = ComponentType<AvatarLive2dViewportComponentProps>;

export type LoadAvatarLive2dViewportComponent = () => Promise<{
  default: AvatarLive2dViewportComponent;
}>;

export type CreateLazyLive2dAvatarRendererOptions = {
  loadViewport: LoadAvatarLive2dViewportComponent;
  loadingFallback?: ReactNode;
  className?: string;
};

function clampDeltaTimeSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1 / 60;
  }
  return Math.min(value, 0.1);
}

function clampUnit(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(value, 1));
}

function easeToward(current: number, target: number, response: number, deltaTimeSeconds: number): number {
  const dt = clampDeltaTimeSeconds(deltaTimeSeconds);
  const alpha = 1 - Math.exp(-Math.max(response, 0.001) * dt);
  return current + (target - current) * alpha;
}

function phaseLabel(
  phase: AvatarLive2dViewportRenderInput['snapshot']['interaction']['phase'],
): string {
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
      return 'Ready';
  }
}

function resolvePalette(
  emotion: AvatarLive2dViewportState['emotion'],
): Pick<AvatarLive2dViewportState, 'accentColor' | 'glowColor'> {
  switch (emotion) {
    case 'joy':
      return { accentColor: '#fb7185', glowColor: '#fecdd3' };
    case 'focus':
      return { accentColor: '#38bdf8', glowColor: '#bae6fd' };
    case 'calm':
      return { accentColor: '#2dd4bf', glowColor: '#99f6e4' };
    case 'playful':
      return { accentColor: '#f59e0b', glowColor: '#fde68a' };
    case 'concerned':
      return { accentColor: '#8b5cf6', glowColor: '#ddd6fe' };
    case 'surprised':
      return { accentColor: '#f97316', glowColor: '#fdba74' };
    case 'neutral':
    default:
      return { accentColor: '#0ea5e9', glowColor: '#bfdbfe' };
  }
}

function resolveEmotionMotionKeywords(
  emotion: AvatarLive2dViewportState['emotion'],
): readonly string[] {
  switch (emotion) {
    case 'joy':
      return ['joy', 'happy', 'smile', 'cheer'];
    case 'playful':
      return ['playful', 'fun', 'happy', 'smile'];
    case 'concerned':
      return ['concern', 'worry', 'sad', 'trouble'];
    case 'surprised':
      return ['surprise', 'shock'];
    default:
      return [];
  }
}

function hasExpressiveEmotion(
  emotion: AvatarLive2dViewportState['emotion'],
): boolean {
  return resolveEmotionMotionKeywords(emotion).length > 0;
}

function resolveEmotionMotionProfile(
  emotion: AvatarLive2dViewportState['emotion'],
): {
  motionSpeedOffset: number;
  scaleBoost: number;
  swayXBoost: number;
  swayYBias: number;
} {
  switch (emotion) {
    case 'joy':
      return {
        motionSpeedOffset: 0.06,
        scaleBoost: 0.003,
        swayXBoost: 0.003,
        swayYBias: 0.002,
      };
    case 'playful':
      return {
        motionSpeedOffset: 0.1,
        scaleBoost: 0.004,
        swayXBoost: 0.0045,
        swayYBias: 0.0025,
      };
    case 'concerned':
      return {
        motionSpeedOffset: -0.04,
        scaleBoost: -0.001,
        swayXBoost: -0.002,
        swayYBias: -0.004,
      };
    case 'surprised':
      return {
        motionSpeedOffset: 0.14,
        scaleBoost: 0.005,
        swayXBoost: 0.0025,
        swayYBias: 0.006,
      };
    case 'calm':
      return {
        motionSpeedOffset: -0.05,
        scaleBoost: -0.0015,
        swayXBoost: -0.002,
        swayYBias: 0,
      };
    case 'focus':
      return {
        motionSpeedOffset: 0.02,
        scaleBoost: 0,
        swayXBoost: -0.0015,
        swayYBias: -0.002,
      };
    case 'neutral':
    default:
      return {
        motionSpeedOffset: 0,
        scaleBoost: 0,
        swayXBoost: 0,
        swayYBias: 0,
      };
  }
}

function hasStrongVerticalLayout(layout: ReadonlyMap<string, number>): boolean {
  return layout.has('CenterY')
    || layout.has('Y')
    || layout.has('Top')
    || layout.has('Bottom');
}

function renderDefaultLive2dSurface(context: AvatarStageRendererContext): ReactNode {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.98),rgba(226,232,240,0.94)_55%,rgba(203,213,225,0.84))]">
      {context.renderer.posterUrl ? (
        <img
          src={context.renderer.posterUrl}
          alt={context.label}
          className="absolute inset-0 h-full w-full object-cover opacity-34"
        />
      ) : null}
      <span className="absolute inset-[14%] rounded-[42%] border border-white/80 bg-[radial-gradient(circle,rgba(255,255,255,0.92),rgba(219,234,254,0.42))] shadow-[0_18px_40px_rgba(15,23,42,0.08)]" />
      <span className="absolute inset-x-[28%] top-[16%] h-[44%] rounded-[44%_44%_38%_38%] border border-cyan-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(224,242,254,0.72))]" />
      <span className="absolute inset-x-[24%] bottom-[16%] top-[42%] rounded-[999px_999px_34%_34%] border border-sky-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(224,242,254,0.54))]" />
      <span className="absolute bottom-3 rounded-full border border-white/80 bg-slate-900/84 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
        Live2D
      </span>
    </div>
  );
}

export function createLive2dAvatarRenderer(): AvatarStageBackendRenderer {
  return renderDefaultLive2dSurface;
}

export function createLazyLive2dAvatarRenderer(
  options: CreateLazyLive2dAvatarRendererOptions,
): AvatarStageBackendRenderer {
  const LazyViewport = lazy(options.loadViewport);
  return (context) => {
    const viewportInput = createAvatarVrmViewportRenderInput(context);
    return (
      <div className={cn('relative flex h-full w-full items-center justify-center overflow-hidden', options.className)}>
        <Suspense fallback={options.loadingFallback ?? renderDefaultLive2dSurface(context)}>
          <LazyViewport input={viewportInput} />
        </Suspense>
      </div>
    );
  };
}

export function resolveAvatarLive2dFramingPolicy(
  input: AvatarLive2dFramingInput,
): AvatarLive2dFramingPolicy {
  const railIsPortrait = input.railHeight > input.railWidth;
  const canvasWidth = input.modelCanvasWidth && input.modelCanvasWidth > 0 ? input.modelCanvasWidth : null;
  const canvasHeight = input.modelCanvasHeight && input.modelCanvasHeight > 0 ? input.modelCanvasHeight : null;
  const canvasAspect = canvasWidth && canvasHeight ? canvasHeight / canvasWidth : null;
  const intent: AvatarLive2dFramingIntent = input.intent ?? 'auto';

  // Chat Agent framing: bust-style crop that surfaces face and shoulders
  // regardless of model sheet aspect. Conversation UX values eye contact and
  // expression over full-body showcase; 'showcase' intent keeps the legacy
  // full-body behaviour for introductions and profile screens.
  if (intent === 'bottom-companion') {
    return {
      mode: 'chat-focus',
      height: 2.72,
      centerX: 0,
      centerY: -0.34,
    };
  }

  if (intent === 'scene-presence') {
    return {
      mode: 'chat-focus',
      height: 2.38,
      centerX: 0,
      centerY: -0.08,
    };
  }

  if (intent === 'chat-focus' && railIsPortrait) {
    return {
      mode: 'chat-focus',
      height: 2.2,
      centerX: 0,
      centerY: -0.15,
    };
  }

  if (input.layout.size > 0) {
    if (railIsPortrait && !hasStrongVerticalLayout(input.layout)) {
      return {
        mode: 'layout',
        centerX: 0,
        centerY: 0.06,
      };
    }
    return {
      mode: 'layout',
    };
  }

  if (railIsPortrait && canvasAspect !== null) {
    if (canvasAspect >= 1.28) {
      return {
        mode: 'full-body-tall',
        height: 2.2,
        centerX: 0,
        centerY: 0.13,
      };
    }
    if (canvasAspect <= 0.92) {
      return {
        mode: 'wide-in-portrait',
        width: 2,
        centerX: 0,
        centerY: 0.03,
      };
    }
    return {
      mode: 'upper-body-portrait',
      height: 2.22,
      centerX: 0,
      centerY: 0.1,
    };
  }

  return {
    mode: 'default',
    height: 2,
    centerX: 0,
    centerY: 0,
  };
}

export function resolvePreferredLive2dIdleMotionGroup(groups: string[]): string | null {
  const exact = groups.find((group) => group.trim().toLowerCase() === 'idle');
  if (exact) {
    return exact;
  }
  return groups.find((group) => {
    const normalized = group.trim().toLowerCase();
    return normalized.includes('idle') || normalized.includes('home') || normalized.includes('default');
  }) || null;
}

export function resolvePreferredLive2dSpeechMotionGroup(groups: string[]): string | null {
  return groups.find((group) => {
    const normalized = group.trim().toLowerCase();
    return normalized.includes('speak')
      || normalized.includes('talk')
      || normalized.includes('voice')
      || normalized.includes('mouth');
  }) || null;
}

export function resolvePreferredLive2dEmotionMotionGroup(
  groups: string[],
  emotion: AvatarLive2dViewportState['emotion'],
): string | null {
  const keywords = resolveEmotionMotionKeywords(emotion);
  if (keywords.length === 0) {
    return null;
  }
  return groups.find((group) => {
    const normalized = group.trim().toLowerCase();
    return keywords.some((keyword) => normalized.includes(keyword));
  }) || null;
}

export function resolveAvatarLive2dViewportState(
  input: AvatarLive2dViewportRenderInput,
  source?: Pick<{ assetLabel: string }, 'assetLabel'> | null,
): AvatarLive2dViewportState {
  const phase = input.snapshot.interaction.phase;
  const emotion = input.snapshot.interaction.emotion || 'neutral';
  const amplitude = clampUnit(input.snapshot.interaction.amplitude);
  const palette = resolvePalette(emotion);
  const emotionProfile = resolveEmotionMotionProfile(emotion);

  const baseMotionSpeed = phase === 'speaking'
    ? 1.1 + amplitude * 0.8
    : phase === 'thinking'
      ? 0.68
      : phase === 'listening'
        ? 0.76
        : 0.52;

  return {
    phase,
    emotion,
    amplitude,
    badgeLabel: input.snapshot.interaction.actionCue || phaseLabel(phase),
    assetLabel: source?.assetLabel || formatAvatarVrmAssetLabel(input.assetRef) || 'avatar.model3.json',
    motionSpeed: Math.max(0.2, baseMotionSpeed + emotionProfile.motionSpeedOffset),
    accentColor: palette.accentColor,
    glowColor: palette.glowColor,
  };
}

export function resolveAvatarLive2dMotionSelection(input: {
  phase: AvatarLive2dViewportState['phase'];
  emotion?: AvatarLive2dViewportState['emotion'];
  idleMotionGroup: string | null;
  speechMotionGroup: string | null;
  motionGroups: readonly string[];
}): AvatarLive2dMotionSelection {
  const groups = input.motionGroups.filter((value) => typeof value === 'string' && value.trim().length > 0);
  const idleGroup = input.idleMotionGroup && input.idleMotionGroup.trim() ? input.idleMotionGroup : null;
  const speechGroup = input.speechMotionGroup && input.speechMotionGroup.trim() ? input.speechMotionGroup : null;
  const firstGroup = groups[0] ?? null;
  const firstNonIdleGroup = groups.find((group) => group !== idleGroup) ?? null;
  const emotion = input.emotion || 'neutral';
  const emotionGroup = input.phase === 'speaking'
    ? null
    : resolvePreferredLive2dEmotionMotionGroup(groups, emotion);
  const expressiveEmotion = hasExpressiveEmotion(emotion);

  if (input.phase === 'speaking') {
    if (speechGroup) {
      return {
        group: speechGroup,
        source: 'speech',
        priority: 3,
        downgrade: 'none',
      };
    }
    if (firstNonIdleGroup) {
      return {
        group: firstNonIdleGroup,
        source: 'fallback-nonidle',
        priority: 2,
        downgrade: 'none',
      };
    }
    if (idleGroup) {
      return {
        group: idleGroup,
        source: 'idle',
        priority: 1,
        downgrade: 'none',
      };
    }
    if (firstGroup) {
      return {
        group: firstGroup,
        source: 'fallback-any',
        priority: 1,
        downgrade: 'none',
      };
    }
    return {
      group: null,
      source: 'ambient-only',
      priority: 0,
      downgrade: 'none',
    };
  }

  if (emotionGroup) {
    return {
      group: emotionGroup,
      source: 'emotion',
      priority: 2,
      downgrade: 'none',
    };
  }

  if (idleGroup) {
    return {
      group: idleGroup,
      source: 'idle',
      priority: 1,
      downgrade: expressiveEmotion ? 'emotion-to-idle' : 'none',
    };
  }
  if (firstGroup) {
    return {
      group: firstGroup,
      source: 'fallback-any',
      priority: 1,
      downgrade: expressiveEmotion ? 'emotion-to-any' : 'none',
    };
  }
  return {
    group: null,
    source: 'ambient-only',
    priority: 0,
    downgrade: expressiveEmotion ? 'emotion-to-ambient' : 'none',
  };
}

export function resolveAvatarLive2dRenderMotionPose(input: {
  previousSmoothedAmplitude: number;
  previousSpeakingEnergy: number;
  deltaTimeSeconds: number;
  seconds: number;
  state: AvatarLive2dViewportState;
}): AvatarLive2dRenderMotionPose {
  const dt = clampDeltaTimeSeconds(input.deltaTimeSeconds);
  const rawAmplitude = Math.max(0, Math.min(input.state.amplitude, 1));
  const speakingTargetAmplitude = input.state.phase === 'speaking' ? rawAmplitude : 0;
  const smoothedAmplitude = easeToward(
    input.previousSmoothedAmplitude,
    speakingTargetAmplitude,
    input.state.phase === 'speaking' ? 12 : 5,
    dt,
  );
  const speakingTargetEnergy = input.state.phase === 'speaking'
    ? Math.max(rawAmplitude, 0.22)
    : 0;
  const speakingEnergy = easeToward(
    input.previousSpeakingEnergy,
    speakingTargetEnergy,
    input.state.phase === 'speaking' ? 9 : 2.4,
    dt,
  );
  const emotionProfile = resolveEmotionMotionProfile(input.state.emotion);

  const breathing = 1 + Math.sin(input.seconds * (0.78 + input.state.motionSpeed * 0.22)) * 0.0105;
  const speakingPulse = 1 + Math.sin(
    input.seconds * (3.4 + smoothedAmplitude * 3.8 + speakingEnergy * 1.2),
  ) * (0.008 + speakingEnergy * 0.024);
  const scale = breathing * speakingPulse + emotionProfile.scaleBoost;

  const swayXAmplitude = input.state.phase === 'thinking'
    ? 0.019
    : input.state.phase === 'listening'
      ? 0.021
      : 0.018 + speakingEnergy * 0.014;
  const adjustedSwayXAmplitude = Math.max(0.006, swayXAmplitude + emotionProfile.swayXBoost);

  const baseYOffset = input.state.phase === 'listening'
    ? -0.002
    : input.state.phase === 'thinking'
      ? -0.012
      : -0.008;
  const swayYAmplitude = 0.014 + speakingEnergy * 0.01;
  const swayY = baseYOffset
    + emotionProfile.swayYBias
    + Math.sin(input.seconds * (0.58 + input.state.motionSpeed * 0.18)) * swayYAmplitude;

  return {
    smoothedAmplitude,
    speakingEnergy,
    scale: Math.max(0.9, scale),
    swayX: Math.sin(input.seconds * (0.32 + input.state.motionSpeed * 0.07)) * adjustedSwayXAmplitude,
    swayY,
  };
}

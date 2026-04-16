import type { AvatarVrmViewportRenderInput } from '@nimiplatform/nimi-kit/features/avatar/vrm';
import { formatAvatarVrmAssetLabel } from '@nimiplatform/nimi-kit/features/avatar/vrm';

export type ChatAgentAvatarVrmViewportState = {
  phase: AvatarVrmViewportRenderInput['snapshot']['interaction']['phase'];
  emotion: NonNullable<AvatarVrmViewportRenderInput['snapshot']['interaction']['emotion']> | 'neutral';
  amplitude: number;
  badgeLabel: string;
  assetLabel: string;
  motionSpeed: number;
  sparklesSpeed: number;
  accentColor: string;
  glowColor: string;
};

export type ChatAgentAvatarVrmExpressionWeights = Partial<Record<
  'happy' | 'sad' | 'relaxed' | 'surprised' | 'aa' | 'ih' | 'ou' | 'ee' | 'oh',
  number
>>;

function phaseLabel(
  phase: AvatarVrmViewportRenderInput['snapshot']['interaction']['phase'],
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

function clampUnit(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(value, 1));
}

function resolvePalette(
  emotion: ChatAgentAvatarVrmViewportState['emotion'],
): Pick<ChatAgentAvatarVrmViewportState, 'accentColor' | 'glowColor'> {
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
      return { accentColor: '#a78bfa', glowColor: '#ddd6fe' };
    case 'surprised':
      return { accentColor: '#f97316', glowColor: '#fdba74' };
    case 'neutral':
    default:
      return { accentColor: '#0ea5e9', glowColor: '#bfdbfe' };
  }
}

function clampExpressionWeight(value: number): number {
  return Math.max(0, Math.min(value, 1));
}

function resolveVisemePreset(
  visemeId: string | null | undefined,
): keyof ChatAgentAvatarVrmExpressionWeights | null {
  switch ((visemeId || '').trim().toLowerCase()) {
    case 'a':
    case 'aa':
      return 'aa';
    case 'i':
    case 'ih':
      return 'ih';
    case 'u':
    case 'ou':
      return 'ou';
    case 'e':
    case 'ee':
      return 'ee';
    case 'o':
    case 'oh':
      return 'oh';
    default:
      return null;
  }
}

export function resolveChatAgentAvatarVrmAssetUrl(assetRef: string): string | null {
  const normalized = assetRef.trim();
  if (!normalized || normalized.startsWith('fallback://')) {
    return null;
  }
  return normalized;
}

export function resolveChatAgentAvatarVrmViewportState(
  input: AvatarVrmViewportRenderInput,
): ChatAgentAvatarVrmViewportState {
  const phase = input.snapshot.interaction.phase;
  const emotion = input.snapshot.interaction.emotion || 'neutral';
  const amplitude = clampUnit(input.snapshot.interaction.amplitude);
  const palette = resolvePalette(emotion);

  return {
    phase,
    emotion,
    amplitude,
    badgeLabel: input.snapshot.interaction.actionCue || phaseLabel(phase),
    assetLabel: formatAvatarVrmAssetLabel(input.assetRef) || 'avatar.vrm',
    motionSpeed: phase === 'speaking' ? 1.5 + amplitude * 1.2 : phase === 'thinking' ? 0.8 : phase === 'listening' ? 0.55 : 0.35,
    sparklesSpeed: phase === 'speaking' ? 0.9 + amplitude * 0.8 : phase === 'thinking' ? 0.45 : 0.25,
    accentColor: palette.accentColor,
    glowColor: palette.glowColor,
  };
}

export function resolveChatAgentAvatarVrmExpressionWeights(
  input: AvatarVrmViewportRenderInput,
): ChatAgentAvatarVrmExpressionWeights {
  const emotion = input.snapshot.interaction.emotion || 'neutral';
  const phase = input.snapshot.interaction.phase;
  const amplitude = clampUnit(input.snapshot.interaction.amplitude);
  const weights: ChatAgentAvatarVrmExpressionWeights = {};

  switch (emotion) {
    case 'joy':
      weights.happy = 0.52;
      break;
    case 'concerned':
      weights.sad = 0.42;
      break;
    case 'calm':
    case 'focus':
      weights.relaxed = 0.34;
      break;
    case 'surprised':
      weights.surprised = 0.58;
      break;
    default:
      break;
  }

  if (phase === 'thinking') {
    weights.relaxed = Math.max(weights.relaxed ?? 0, 0.28);
  }

  if (phase === 'speaking') {
    const visemePreset = resolveVisemePreset(input.snapshot.interaction.visemeId);
    if (visemePreset) {
      weights[visemePreset] = clampExpressionWeight(0.35 + amplitude * 0.65);
    } else {
      weights.aa = clampExpressionWeight(0.18 + amplitude * 0.5);
    }
  }

  return weights;
}

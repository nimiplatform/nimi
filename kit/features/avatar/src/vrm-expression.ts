import type { AvatarVrmViewportRenderInput } from './vrm.js';

export type AvatarVrmExpressionWeights = Partial<Record<
  'happy' | 'sad' | 'relaxed' | 'surprised' | 'aa' | 'ih' | 'ou' | 'ee' | 'oh',
  number
>>;

function clampUnit(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(value, 1));
}

function clampExpressionWeight(value: number): number {
  return Math.max(0, Math.min(value, 1));
}

function resolveVisemePreset(
  visemeId: string | null | undefined,
): keyof AvatarVrmExpressionWeights | null {
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

export function resolveAvatarVrmExpressionWeights(
  input: AvatarVrmViewportRenderInput,
): AvatarVrmExpressionWeights {
  const emotion = input.snapshot.interaction.emotion || 'neutral';
  const phase = input.snapshot.interaction.phase;
  const amplitude = clampUnit(input.snapshot.interaction.amplitude);
  const weights: AvatarVrmExpressionWeights = {};

  switch (emotion) {
    case 'joy':
      weights.happy = 0.82;
      break;
    case 'playful':
      weights.happy = 0.66;
      weights.relaxed = 0.3;
      break;
    case 'concerned':
      weights.sad = 0.72;
      break;
    case 'calm':
      weights.relaxed = 0.56;
      break;
    case 'focus':
      weights.relaxed = 0.42;
      break;
    case 'surprised':
      weights.surprised = 0.84;
      break;
    default:
      break;
  }

  if (phase === 'thinking') {
    weights.relaxed = Math.max(weights.relaxed ?? 0, 0.3);
  }

  if (phase === 'listening') {
    weights.relaxed = Math.max(weights.relaxed ?? 0, 0.16);
  }

  if (phase === 'speaking') {
    const visemePreset = resolveVisemePreset(input.snapshot.interaction.visemeId);
    if (visemePreset) {
      weights[visemePreset] = clampExpressionWeight(0.4 + amplitude * 0.6);
    } else {
      weights.aa = clampExpressionWeight(0.24 + amplitude * 0.56);
    }
  }

  return weights;
}

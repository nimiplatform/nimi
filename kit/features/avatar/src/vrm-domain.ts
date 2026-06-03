import type { AvatarVrmViewportRenderInput } from './vrm.js';
export {
  measureAvatarVrmFramingMetrics,
  resolveAvatarVrmFramingFromScene,
  resolveAvatarVrmFramingPolicy,
  resolveAvatarVrmFramingResult,
} from './vrm-framing.js';
export type {
  AvatarVrmFramingIntent,
  AvatarVrmFramingMetrics,
  AvatarVrmFramingPolicy,
  AvatarVrmFramingResult,
} from './vrm-framing.js';

export type AvatarAttentionState = {
  active: boolean;
  presence: number;
  normalizedX: number;
  normalizedY: number;
  attentionBoost: 'idle' | 'attentive' | 'engaged';
};

const ATTENTION_ENGAGED_WEIGHT = 1.08;
const ATTENTION_ATTENTIVE_WEIGHT = 0.74;
const HEAD_FOLLOW_X_SCALE = 0.24;
const HEAD_FOLLOW_Y_SCALE = 0.14;
const EYE_FOLLOW_X_SCALE = 0.09;
const EYE_FOLLOW_Y_SCALE = 0.06;

export type AvatarVrmViewportState = {
  phase: AvatarVrmViewportRenderInput['snapshot']['interaction']['phase'];
  posture: 'idle-settled' | 'listening-attentive' | 'thinking-reflective' | 'speaking-energized' | 'transitioning-settle';
  emotion: NonNullable<AvatarVrmViewportRenderInput['snapshot']['interaction']['emotion']> | 'neutral';
  amplitude: number;
  speakingEnergy: number;
  attentionInfluence: number;
  headFollowX: number;
  headFollowY: number;
  eyeFollowX: number;
  eyeFollowY: number;
  badgeLabel: string;
  assetLabel: string;
  motionSpeed: number;
  sparklesSpeed: number;
  bodyYawAmplitude: number;
  bodyPitchAmplitude: number;
  bodyLiftAmplitude: number;
  breathingSpeed: number;
  breathingScaleAmount: number;
  speakingPulseSpeed: number;
  speakingPulseAmount: number;
  mouthOpen: number;
  eyeOpen: number;
  blinkSpeed: number;
  accentColor: string;
  glowColor: string;
};

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

function clampSignedUnit(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(-1, Math.min(value, 1));
}

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

function resolvePalette(
  emotion: AvatarVrmViewportState['emotion'],
): Pick<AvatarVrmViewportState, 'accentColor' | 'glowColor'> {
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

function resolvePhasePosture(input: {
  phase: AvatarVrmViewportRenderInput['snapshot']['interaction']['phase'];
  amplitude: number;
  attentionLift: number;
}): Pick<
  AvatarVrmViewportState,
  | 'posture'
  | 'speakingEnergy'
  | 'motionSpeed'
  | 'sparklesSpeed'
  | 'bodyYawAmplitude'
  | 'bodyPitchAmplitude'
  | 'bodyLiftAmplitude'
  | 'breathingSpeed'
  | 'breathingScaleAmount'
  | 'speakingPulseSpeed'
  | 'speakingPulseAmount'
  | 'mouthOpen'
  | 'eyeOpen'
  | 'blinkSpeed'
> {
  switch (input.phase) {
    case 'speaking': {
      const speakingEnergy = clampUnit(0.35 + input.amplitude * 0.65);
      return {
        posture: 'speaking-energized',
        speakingEnergy,
        motionSpeed: 1.45 + input.amplitude * 1.15 + input.attentionLift * 0.35,
        sparklesSpeed: 0.82 + input.amplitude * 0.72 + input.attentionLift * 0.5,
        bodyYawAmplitude: 0.075,
        bodyPitchAmplitude: 0.028,
        bodyLiftAmplitude: 0.022,
        breathingSpeed: 1 + input.amplitude * 0.7,
        breathingScaleAmount: 0.018 + input.amplitude * 0.016,
        speakingPulseSpeed: 4.2 + input.amplitude * 6,
        speakingPulseAmount: 0.016 + input.amplitude * 0.028,
        mouthOpen: 0.14 + input.amplitude * 0.18,
        eyeOpen: 0.082,
        blinkSpeed: 6,
      };
    }
    case 'listening':
      return {
        posture: 'listening-attentive',
        speakingEnergy: 0,
        motionSpeed: 0.54 + input.attentionLift * 0.8,
        sparklesSpeed: 0.28 + input.attentionLift * 0.5,
        bodyYawAmplitude: 0.09,
        bodyPitchAmplitude: 0.035,
        bodyLiftAmplitude: 0.03,
        breathingSpeed: 0.92,
        breathingScaleAmount: 0.014,
        speakingPulseSpeed: 0,
        speakingPulseAmount: 0,
        mouthOpen: 0.11,
        eyeOpen: 0.09,
        blinkSpeed: 3.6,
      };
    case 'thinking':
      return {
        posture: 'thinking-reflective',
        speakingEnergy: 0,
        motionSpeed: 0.76 + input.attentionLift * 0.45,
        sparklesSpeed: 0.42 + input.attentionLift * 0.38,
        bodyYawAmplitude: 0.11,
        bodyPitchAmplitude: 0.05,
        bodyLiftAmplitude: 0.034,
        breathingSpeed: 0.74,
        breathingScaleAmount: 0.015,
        speakingPulseSpeed: 0,
        speakingPulseAmount: 0,
        mouthOpen: 0.1,
        eyeOpen: 0.05,
        blinkSpeed: 2.2,
      };
    case 'transitioning':
      return {
        posture: 'transitioning-settle',
        speakingEnergy: 0,
        motionSpeed: 0.44 + input.attentionLift * 0.6,
        sparklesSpeed: 0.24 + input.attentionLift * 0.4,
        bodyYawAmplitude: 0.095,
        bodyPitchAmplitude: 0.032,
        bodyLiftAmplitude: 0.026,
        breathingSpeed: 0.84,
        breathingScaleAmount: 0.013,
        speakingPulseSpeed: 0,
        speakingPulseAmount: 0,
        mouthOpen: 0.11,
        eyeOpen: 0.078,
        blinkSpeed: 3.1,
      };
    case 'idle':
    default:
      return {
        posture: 'idle-settled',
        speakingEnergy: 0,
        motionSpeed: 0.35 + input.attentionLift,
        sparklesSpeed: 0.25 + input.attentionLift * 0.85,
        bodyYawAmplitude: 0.1,
        bodyPitchAmplitude: 0.032,
        bodyLiftAmplitude: 0.03,
        breathingSpeed: 0.8 + input.amplitude * 0.6,
        breathingScaleAmount: 0.012 + input.amplitude * 0.012,
        speakingPulseSpeed: 0,
        speakingPulseAmount: 0,
        mouthOpen: 0.11,
        eyeOpen: 0.08,
        blinkSpeed: 3.2,
      };
  }
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

export function resolveAvatarVrmViewportState(
  input: AvatarVrmViewportRenderInput,
  attention?: AvatarAttentionState | null,
): AvatarVrmViewportState {
  const phase = input.snapshot.interaction.phase;
  const emotion = input.snapshot.interaction.emotion || 'neutral';
  const amplitude = clampUnit(input.snapshot.interaction.amplitude);
  const palette = resolvePalette(emotion);
  const attentionWeight = !attention?.active
    ? 0
    : attention.attentionBoost === 'engaged'
      ? ATTENTION_ENGAGED_WEIGHT
      : ATTENTION_ATTENTIVE_WEIGHT;
  const attentionPresence = clampUnit(
    attention?.presence ?? (attention?.active ? 1 : 0),
  );
  const phaseWeight = phase === 'speaking'
    ? 0.18 + (1 - amplitude) * 0.14
    : phase === 'listening'
      ? 0.34
      : phase === 'thinking'
        ? 0.24
        : phase === 'transitioning'
          ? 0.2
          : 0.52;
  const attentionInfluence = clampUnit(attentionWeight * phaseWeight * attentionPresence);
  const normalizedX = clampSignedUnit(attention?.normalizedX);
  const normalizedY = clampSignedUnit(attention?.normalizedY);
  const headFollowX = normalizedX * attentionInfluence * HEAD_FOLLOW_X_SCALE;
  const headFollowY = -normalizedY * attentionInfluence * HEAD_FOLLOW_Y_SCALE;
  const eyeFollowX = normalizedX * attentionInfluence * EYE_FOLLOW_X_SCALE;
  const eyeFollowY = -normalizedY * attentionInfluence * EYE_FOLLOW_Y_SCALE;
  const attentionLift = attentionInfluence * (phase === 'speaking' ? 0.06 : 0.12);
  const posture = resolvePhasePosture({
    phase,
    amplitude,
    attentionLift,
  });
  const assetLabel = input.assetRef.trim().startsWith('fallback://')
    ? input.assetRef.trim().replace('fallback://', '')
    : input.assetRef.trim().split('/').pop() || 'avatar.vrm';

  return {
    phase,
    posture: posture.posture,
    emotion,
    amplitude,
    speakingEnergy: posture.speakingEnergy,
    attentionInfluence,
    headFollowX,
    headFollowY,
    eyeFollowX,
    eyeFollowY,
    badgeLabel: input.snapshot.interaction.actionCue || phaseLabel(phase),
    assetLabel,
    motionSpeed: posture.motionSpeed,
    sparklesSpeed: posture.sparklesSpeed,
    bodyYawAmplitude: posture.bodyYawAmplitude,
    bodyPitchAmplitude: posture.bodyPitchAmplitude,
    bodyLiftAmplitude: posture.bodyLiftAmplitude,
    breathingSpeed: posture.breathingSpeed,
    breathingScaleAmount: posture.breathingScaleAmount,
    speakingPulseSpeed: posture.speakingPulseSpeed,
    speakingPulseAmount: posture.speakingPulseAmount,
    mouthOpen: posture.mouthOpen,
    eyeOpen: posture.eyeOpen,
    blinkSpeed: posture.blinkSpeed,
    accentColor: palette.accentColor,
    glowColor: palette.glowColor,
  };
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

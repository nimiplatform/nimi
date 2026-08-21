import type { AvatarVrmViewportRenderInput } from './vrm.js';
import { resolveAvatarVrmPhasePosture } from './vrm-phase-posture.js';
export {
  computeVrmCameraFraming,
} from './vrm-camera-framing.js';
export type {
  VrmCameraFramingInput,
  VrmCameraFramingIntent,
  VrmCameraFramingResult,
  VrmCameraFramingVector,
} from './vrm-camera-framing.js';
export {
  createVrmEmoteState,
  DEFAULT_TRANSIENT_FADE_SEC,
  PRIMARY_EXPRESSION_WEIGHT_CAP,
  VISEME_NAMES,
} from './vrm-emote-state.js';
export {
  normalizeVrmEmoteTable,
} from './vrm-emote-table.js';
export type {
  CreateVrmEmoteStateInputs,
  VrmEmoteBundle,
  VrmEmoteSnapshot,
  VrmEmoteState,
  VrmEmoteTable,
  VrmExpressionWritable,
} from './vrm-emote-state.js';
export {
  ADMITTED_INTERCHANGE_PRESET_IDS,
  normalizeVrmMotionPresetTable,
} from './vrm-motion-preset-table.js';
export type {
  VrmMotionPresetEntry,
  VrmMotionPresetTable,
} from './vrm-motion-preset-table.js';
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
export {
  resolveAvatarVrmExpressionWeights,
} from './vrm-expression.js';
export type {
  AvatarVrmExpressionWeights,
} from './vrm-expression.js';

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
  /**
   * Display cue for viewport badges: the interaction `actionCue` when present,
   * otherwise the phase id. UI layers map the phase id to text through
   * `resolveAvatarPhaseLabel` (injectable label map, English by default).
   */
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
};

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

export function resolveAvatarVrmViewportState(
  input: AvatarVrmViewportRenderInput,
  attention?: AvatarAttentionState | null,
): AvatarVrmViewportState {
  const phase = input.snapshot.interaction.phase;
  const emotion = input.snapshot.interaction.emotion || 'neutral';
  const amplitude = clampUnit(input.snapshot.interaction.amplitude);
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
  const posture = resolveAvatarVrmPhasePosture({
    phase,
    amplitude,
    attentionLift,
  });
  const assetLabel = input.assetRef.trim().split('/').pop() || 'avatar.vrm';

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
    badgeLabel: input.snapshot.interaction.actionCue || phase,
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
  };
}

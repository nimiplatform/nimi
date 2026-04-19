import * as THREE from 'three';

import type { AvatarVrmViewportRenderInput } from './vrm.js';

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
const FALLBACK_VRM_WIDTH = 0.9;
const FALLBACK_VRM_HEIGHT = 1.8;
const FALLBACK_VRM_DEPTH = 0.75;
const FALLBACK_RAIL_WIDTH = 360;
const FALLBACK_RAIL_HEIGHT = 820;

type AvatarVrmSceneObject = unknown;

export type AvatarVrmFramingMetrics = {
  width: number;
  height: number;
  depth: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  silhouetteAspect: number;
  widthRatio: number;
};

export type AvatarVrmFramingIntent = 'auto' | 'chat-focus' | 'showcase';

export type AvatarVrmFramingPolicy = {
  mode: 'full-body-tall' | 'upper-body-portrait' | 'broad-portrait' | 'default' | 'chat-focus';
  selectionReason:
    | 'silhouette-aspect-threshold'
    | 'width-ratio-threshold'
    | 'portrait-default'
    | 'landscape-default'
    | 'chat-focus-intent';
  fitHeight: number;
  fitWidth: number;
  fitDepth: number;
  targetTop: number;
  minBottom: number;
  zOffset: number;
};

export type AvatarVrmFramingResult = {
  metrics: AvatarVrmFramingMetrics;
  policy: AvatarVrmFramingPolicy;
  railWidth: number;
  railHeight: number;
  railAspect: number;
  railIsPortrait: boolean;
  scale: number;
  positionX: number;
  positionY: number;
  positionZ: number;
};

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

function normalizeDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

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

function normalizeRailDimensions(input: {
  railWidth: number;
  railHeight: number;
}): {
  railWidth: number;
  railHeight: number;
  railAspect: number;
  railIsPortrait: boolean;
} {
  const railWidth = normalizeDimension(input.railWidth, FALLBACK_RAIL_WIDTH);
  const railHeight = normalizeDimension(input.railHeight, FALLBACK_RAIL_HEIGHT);
  return {
    railWidth,
    railHeight,
    railAspect: railHeight / railWidth,
    railIsPortrait: railHeight > railWidth,
  };
}

function createFallbackMetrics(): AvatarVrmFramingMetrics {
  const width = FALLBACK_VRM_WIDTH;
  const height = FALLBACK_VRM_HEIGHT;
  const depth = FALLBACK_VRM_DEPTH;
  return {
    width,
    height,
    depth,
    minX: -width / 2,
    minY: -height / 2,
    minZ: -depth / 2,
    maxX: width / 2,
    maxY: height / 2,
    maxZ: depth / 2,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    silhouetteAspect: height / width,
    widthRatio: width / height,
  };
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

export function measureAvatarVrmFramingMetrics(
  scene: AvatarVrmSceneObject,
): AvatarVrmFramingMetrics {
  const box = new THREE.Box3().setFromObject(scene as never);
  if (box.isEmpty()) {
    return createFallbackMetrics();
  }
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const width = normalizeDimension(size.x, FALLBACK_VRM_WIDTH);
  const height = normalizeDimension(size.y, FALLBACK_VRM_HEIGHT);
  const depth = normalizeDimension(size.z, FALLBACK_VRM_DEPTH);
  return {
    width,
    height,
    depth,
    minX: Number.isFinite(box.min.x) ? box.min.x : -width / 2,
    minY: Number.isFinite(box.min.y) ? box.min.y : -height / 2,
    minZ: Number.isFinite(box.min.z) ? box.min.z : -depth / 2,
    maxX: Number.isFinite(box.max.x) ? box.max.x : width / 2,
    maxY: Number.isFinite(box.max.y) ? box.max.y : height / 2,
    maxZ: Number.isFinite(box.max.z) ? box.max.z : depth / 2,
    centerX: Number.isFinite(center.x) ? center.x : 0,
    centerY: Number.isFinite(center.y) ? center.y : 0,
    centerZ: Number.isFinite(center.z) ? center.z : 0,
    silhouetteAspect: height / width,
    widthRatio: width / height,
  };
}

export function resolveAvatarVrmFramingPolicy(input: {
  railWidth: number;
  railHeight: number;
  metrics: AvatarVrmFramingMetrics;
  intent?: AvatarVrmFramingIntent;
}): AvatarVrmFramingPolicy {
  const rail = normalizeRailDimensions(input);
  const intent: AvatarVrmFramingIntent = input.intent ?? 'auto';

  // Chat Agent bust framing: surfaces face and shoulders by scaling the model
  // ~70% larger than the portrait full-body framing and relying on the viewport
  // to crop below the torso. 'showcase' keeps the legacy full-body behaviour
  // for intros and profile screens.
  if (intent === 'chat-focus' && rail.railIsPortrait) {
    return {
      mode: 'chat-focus',
      selectionReason: 'chat-focus-intent',
      fitHeight: 3.8,
      fitWidth: 2.4,
      fitDepth: 2,
      targetTop: 1.18,
      minBottom: -5,
      zOffset: -0.22,
    };
  }

  if (rail.railIsPortrait) {
    if (input.metrics.silhouetteAspect >= 2.6) {
      return {
        mode: 'full-body-tall',
        selectionReason: 'silhouette-aspect-threshold',
        fitHeight: 2.94,
        fitWidth: 1.88,
        fitDepth: 1.5,
        targetTop: 1.52,
        minBottom: -1.98,
        zOffset: -0.18,
      };
    }
    if (input.metrics.widthRatio >= 0.58) {
      return {
        mode: 'broad-portrait',
        selectionReason: 'width-ratio-threshold',
        fitHeight: 2.68,
        fitWidth: 1.72,
        fitDepth: 1.42,
        targetTop: 1.48,
        minBottom: -1.88,
        zOffset: -0.12,
      };
    }
    return {
      mode: 'upper-body-portrait',
      selectionReason: 'portrait-default',
      fitHeight: 2.72,
      fitWidth: 1.9,
      fitDepth: 1.5,
      targetTop: 1.46,
      minBottom: -1.78,
      zOffset: -0.16,
    };
  }
  return {
    mode: 'default',
    selectionReason: 'landscape-default',
    fitHeight: 2.82,
    fitWidth: 1.96,
    fitDepth: 1.52,
    targetTop: 1.48,
    minBottom: -1.96,
    zOffset: -0.18,
  };
}

export function resolveAvatarVrmFramingResult(input: {
  railWidth: number;
  railHeight: number;
  metrics: AvatarVrmFramingMetrics;
  intent?: AvatarVrmFramingIntent;
}): AvatarVrmFramingResult {
  const rail = normalizeRailDimensions(input);
  const policy = resolveAvatarVrmFramingPolicy({
    railWidth: rail.railWidth,
    railHeight: rail.railHeight,
    metrics: input.metrics,
    intent: input.intent,
  });
  const scale = Math.min(
    policy.fitHeight / input.metrics.height,
    policy.fitWidth / input.metrics.width,
    policy.fitDepth / input.metrics.depth,
  );
  const anchoredTopY = policy.targetTop - input.metrics.maxY * scale;
  const protectedBottomY = policy.minBottom - input.metrics.minY * scale;
  return {
    metrics: input.metrics,
    policy,
    railWidth: rail.railWidth,
    railHeight: rail.railHeight,
    railAspect: rail.railAspect,
    railIsPortrait: rail.railIsPortrait,
    scale,
    positionX: -input.metrics.centerX * scale,
    positionY: Math.max(anchoredTopY, protectedBottomY),
    positionZ: -input.metrics.centerZ * scale + policy.zOffset,
  };
}

export function resolveAvatarVrmFramingFromScene(input: {
  railWidth: number;
  railHeight: number;
  scene: AvatarVrmSceneObject;
  intent?: AvatarVrmFramingIntent;
}): AvatarVrmFramingResult {
  return resolveAvatarVrmFramingResult({
    railWidth: input.railWidth,
    railHeight: input.railHeight,
    metrics: measureAvatarVrmFramingMetrics(input.scene),
    intent: input.intent,
  });
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
      weights.happy = 0.52;
      break;
    case 'playful':
      weights.happy = 0.3;
      weights.relaxed = 0.18;
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

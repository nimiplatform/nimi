import type { AvatarVrmViewportRenderInput } from './vrm.js';

export type AvatarVrmPhasePostureState = {
  posture: 'idle-settled' | 'listening-attentive' | 'thinking-reflective' | 'speaking-energized' | 'transitioning-settle';
  speakingEnergy: number;
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

export function resolveAvatarVrmPhasePosture(input: {
  phase: AvatarVrmViewportRenderInput['snapshot']['interaction']['phase'];
  amplitude: number;
  attentionLift: number;
}): AvatarVrmPhasePostureState {
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

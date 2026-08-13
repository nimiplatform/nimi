import type { Live2DVisualModelShape } from './carrier-visual-runtime.js';
import { readLive2DKnownParameterIds } from './live2d-parameter-ids.js';

const PARAM_EYE_BALL_X = 'ParamEyeBallX';
const PARAM_EYE_BALL_Y = 'ParamEyeBallY';
const PARAM_EYE_L_OPEN = 'ParamEyeLOpen';
const PARAM_EYE_R_OPEN = 'ParamEyeROpen';
const PARAM_ANGLE_X = 'ParamAngleX';
const PARAM_ANGLE_Y = 'ParamAngleY';

const GAZE_PARAMETER_IDS = [PARAM_EYE_BALL_X, PARAM_EYE_BALL_Y] as const;
const BLINK_PARAMETER_IDS = [PARAM_EYE_L_OPEN, PARAM_EYE_R_OPEN] as const;

export type Live2DLookAtIdleReasonCode =
  | 'ready'
  | 'eye_parameters_missing'
  | 'eye_parameters_partial';

export type Live2DLookAtIdleFrame = {
  applied: boolean;
  gazeSupported: boolean;
  blinkSupported: boolean;
  parameterIds: readonly string[];
  reasonCode: Live2DLookAtIdleReasonCode;
};

export type Live2DLookAtIdleController = {
  apply(input: {
    model: Live2DVisualModelShape;
    deltaTimeSeconds: number;
    seconds: number;
    directParameters: ReadonlyMap<string, number>;
  }): Live2DLookAtIdleFrame;
  snapshot(): Omit<Live2DLookAtIdleFrame, 'applied'>;
};

function hasParameter(model: Live2DVisualModelShape, knownIds: Set<string> | null, parameterId: string): boolean {
  if (knownIds) {
    return knownIds.has(parameterId);
  }
  if (typeof model.getParameterValueById === 'function') {
    return Number.isFinite(model.getParameterValueById(parameterId));
  }
  return false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function finiteMapValue(parameters: ReadonlyMap<string, number>, parameterId: string): number | null {
  const value = parameters.get(parameterId);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function blinkOpenAmount(seconds: number): number {
  const phase = ((seconds % 4.2) + 4.2) % 4.2;
  if (phase < 0.05) {
    return 0;
  }
  if (phase < 0.14) {
    return round((phase - 0.05) / 0.09);
  }
  return 1;
}

function resolveSupport(model: Live2DVisualModelShape): Omit<Live2DLookAtIdleFrame, 'applied'> {
  const knownIds = readLive2DKnownParameterIds(model);
  const gazeIds = GAZE_PARAMETER_IDS.filter((id) => hasParameter(model, knownIds, id));
  const blinkIds = BLINK_PARAMETER_IDS.filter((id) => hasParameter(model, knownIds, id));
  const gazeSupported = gazeIds.length === GAZE_PARAMETER_IDS.length;
  const blinkSupported = blinkIds.length === BLINK_PARAMETER_IDS.length;
  const parameterIds = [
    ...(gazeSupported ? [...GAZE_PARAMETER_IDS] : []),
    ...(blinkSupported ? [...BLINK_PARAMETER_IDS] : []),
  ];
  const detectedCount = gazeIds.length + blinkIds.length;
  return {
    gazeSupported,
    blinkSupported,
    parameterIds,
    reasonCode: gazeSupported || blinkSupported
      ? 'ready'
      : detectedCount > 0
        ? 'eye_parameters_partial'
        : 'eye_parameters_missing',
  };
}

export function createLive2DLookAtIdleController(
  model: Live2DVisualModelShape,
): Live2DLookAtIdleController {
  const support = resolveSupport(model);
  let gazeX = 0;
  let gazeY = 0;

  return {
    apply(input) {
      let applied = false;
      if (support.gazeSupported) {
        const angleX = finiteMapValue(input.directParameters, PARAM_ANGLE_X);
        const angleY = finiteMapValue(input.directParameters, PARAM_ANGLE_Y);
        const idleSaccadeX = Math.sin(input.seconds * 2.3) * 0.1;
        const idleSaccadeY = Math.sin(input.seconds * 1.7 + 0.8) * 0.06;
        const targetX = angleX === null ? idleSaccadeX : clamp(angleX / 15, -1, 1);
        const targetY = angleY === null ? idleSaccadeY : clamp(-angleY / 10, -1, 1);
        const smoothing = clamp(input.deltaTimeSeconds * 14, 0.08, 1);
        gazeX += (targetX - gazeX) * smoothing;
        gazeY += (targetY - gazeY) * smoothing;
        input.model.setParameterValueById(PARAM_EYE_BALL_X, round(gazeX), 1);
        input.model.setParameterValueById(PARAM_EYE_BALL_Y, round(gazeY), 1);
        applied = true;
      }
      if (support.blinkSupported) {
        const open = blinkOpenAmount(input.seconds);
        if (open < 0.999) {
          input.model.setParameterValueById(PARAM_EYE_L_OPEN, open, 1);
          input.model.setParameterValueById(PARAM_EYE_R_OPEN, open, 1);
          applied = true;
        }
      }
      return { ...support, applied };
    },
    snapshot() {
      return support;
    },
  };
}

export const LIVE2D_LOOK_AT_IDLE_PARAMETER_IDS = Object.freeze({
  gaze: GAZE_PARAMETER_IDS,
  blink: BLINK_PARAMETER_IDS,
});

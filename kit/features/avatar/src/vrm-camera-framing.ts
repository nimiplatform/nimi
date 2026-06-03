export type VrmCameraFramingIntent = 'full-body' | 'bottom-companion' | 'head-shoulders';

export type VrmCameraFramingVector = { x: number; y: number; z: number };

export type VrmCameraFramingInput = {
  sceneBboxMin: VrmCameraFramingVector;
  sceneBboxMax: VrmCameraFramingVector;
  intent: VrmCameraFramingIntent;
  aspect: number;
};

export type VrmCameraFramingResult = {
  cameraPosition: VrmCameraFramingVector;
  cameraLookAt: VrmCameraFramingVector;
  cameraFov: number;
  framedHeight: number;
  framedWidth: number;
  framedCenterY: number;
};

const FOV_DEGREES = 30;
const FOV_RADIANS = (FOV_DEGREES * Math.PI) / 180;
const CAMERA_DISTANCE_FACTOR = 1.05;
const FULL_BODY_HEIGHT_MARGIN = 1.05;
const HUMANOID_BODY_WIDTH_RATIO = 0.45;
const HORIZONTAL_SAFETY = 1.05;

type IntentParams = {
  cameraYOffsetRatio: number | 'center';
  framedHeightRatio: number;
};

const INTENT_PARAMS: Record<VrmCameraFramingIntent, IntentParams> = {
  'full-body': {
    cameraYOffsetRatio: 'center',
    framedHeightRatio: FULL_BODY_HEIGHT_MARGIN,
  },
  'bottom-companion': {
    cameraYOffsetRatio: 0.55,
    framedHeightRatio: 1,
  },
  'head-shoulders': {
    cameraYOffsetRatio: 0.85,
    framedHeightRatio: 0.3,
  },
};

export function computeVrmCameraFraming(
  input: VrmCameraFramingInput,
): VrmCameraFramingResult {
  const { sceneBboxMin, sceneBboxMax, intent, aspect } = input;
  const totalHeight = sceneBboxMax.y - sceneBboxMin.y;
  const rawTotalWidth = sceneBboxMax.x - sceneBboxMin.x;
  const totalWidth = Math.min(rawTotalWidth, totalHeight * HUMANOID_BODY_WIDTH_RATIO);
  const bboxCenterX = (sceneBboxMin.x + sceneBboxMax.x) / 2;
  const bboxCenterY = (sceneBboxMin.y + sceneBboxMax.y) / 2;
  const bboxCenterZ = (sceneBboxMin.z + sceneBboxMax.z) / 2;
  const params = INTENT_PARAMS[intent];
  const cameraY = params.cameraYOffsetRatio === 'center'
    ? bboxCenterY
    : sceneBboxMin.y + totalHeight * params.cameraYOffsetRatio;
  const intentFramedHeight = totalHeight * params.framedHeightRatio;
  const horizontalFitFramedHeight =
    aspect > 0 ? (totalWidth * HORIZONTAL_SAFETY) / aspect : intentFramedHeight;
  const framedHeight = Math.max(intentFramedHeight, horizontalFitFramedHeight);
  const framedWidth = framedHeight * aspect;
  const cameraDistance =
    (CAMERA_DISTANCE_FACTOR * framedHeight) / (2 * Math.tan(FOV_RADIANS / 2));

  return {
    cameraPosition: {
      x: bboxCenterX,
      y: cameraY,
      z: bboxCenterZ + cameraDistance,
    },
    cameraLookAt: {
      x: bboxCenterX,
      y: cameraY,
      z: bboxCenterZ,
    },
    cameraFov: FOV_DEGREES,
    framedHeight,
    framedWidth,
    framedCenterY: cameraY,
  };
}

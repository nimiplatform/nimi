import type { VRM } from '@pixiv/three-vrm';

export type VrmGeneratedRouteId =
  | 'idle_subtle'
  | 'listen_lean'
  | 'nod_yes'
  | 'shake_no'
  | 'greet_wave';

export const VRM_GENERATED_ROUTE_IDS: readonly VrmGeneratedRouteId[] = Object.freeze([
  'idle_subtle',
  'listen_lean',
  'nod_yes',
  'shake_no',
  'greet_wave',
]);

export const VRM_CAPABILITY_REQUIRED_BONES = Object.freeze([
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'rightUpperLeg',
  'rightLowerLeg',
] as const);

const ROUTE_REQUIRED_BONES: Readonly<Record<VrmGeneratedRouteId, readonly VrmBoneName[]>> =
  Object.freeze({
    idle_subtle: ['spine', 'head'],
    listen_lean: ['spine', 'head'],
    nod_yes: ['head', 'neck'],
    shake_no: ['head', 'neck'],
    greet_wave: ['spine', 'rightUpperArm', 'rightLowerArm', 'rightHand'],
  });

export type VrmBoneName = (typeof VRM_CAPABILITY_REQUIRED_BONES)[number];

export type VrmCapabilityProfile = {
  profileId: string;
  backendKind: 'vrm';
  humanoidBones: Record<VrmBoneName, boolean>;
  expressionManagerPresent: boolean;
  supportedRoutes: VrmGeneratedRouteId[];
  unsupportedRoutes: Array<{ routeId: VrmGeneratedRouteId; reason: string }>;
  safetyLimits: {
    maxRotationRad: number;
  };
};

export const GENERATED_MOTION_MAX_ROTATION_RAD = 1.2;

export function createVrmCapabilityProfile(vrm: VRM): VrmCapabilityProfile {
  const humanoidBones = {} as Record<VrmBoneName, boolean>;
  for (const bone of VRM_CAPABILITY_REQUIRED_BONES) {
    humanoidBones[bone] = getVrmBoneNode(vrm, bone) !== null;
  }

  const supportedRoutes: VrmGeneratedRouteId[] = [];
  const unsupportedRoutes: Array<{ routeId: VrmGeneratedRouteId; reason: string }> = [];
  for (const routeId of VRM_GENERATED_ROUTE_IDS) {
    const missing = getMissingRouteBones(vrm, routeId);
    if (missing.length === 0) {
      supportedRoutes.push(routeId);
    } else {
      unsupportedRoutes.push({
        routeId,
        reason: `missing_bones:${missing.join(',')}`,
      });
    }
  }

  return {
    profileId: 'vrm-runtime-probe-v1',
    backendKind: 'vrm',
    humanoidBones,
    expressionManagerPresent: Boolean(vrm.expressionManager),
    supportedRoutes,
    unsupportedRoutes,
    safetyLimits: {
      maxRotationRad: GENERATED_MOTION_MAX_ROTATION_RAD,
    },
  };
}

export function getMissingRouteBones(
  vrm: VRM,
  routeId: VrmGeneratedRouteId,
): VrmBoneName[] {
  const required = ROUTE_REQUIRED_BONES[routeId];
  return required.filter((bone) => getVrmBoneNode(vrm, bone) === null) as VrmBoneName[];
}

export function getVrmBoneNode(vrm: VRM, bone: VrmBoneName): { name?: string } | null {
  const humanoid = vrm.humanoid;
  if (!humanoid) return null;
  const getter = humanoid.getNormalizedBoneNode as (name: string) => unknown;
  const node = getter.call(humanoid, bone);
  if (typeof node !== 'object' || node === null) return null;
  return node as { name?: string };
}

export function isVrmGeneratedRouteId(routeId: string): routeId is VrmGeneratedRouteId {
  return (VRM_GENERATED_ROUTE_IDS as readonly string[]).includes(routeId);
}

import type { VRM } from '@pixiv/three-vrm';
import {
  GENERATED_MOTION_MAX_ROTATION_RAD,
  VRM_GENERATED_ROUTE_IDS,
  type VrmGeneratedRouteId,
} from './vrm-generated-motion-contract.js';

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
  modelFingerprint: string;
  humanoidBones: Record<VrmBoneName, boolean>;
  expressionManagerPresent: boolean;
  expressionPresets: {
    present: boolean;
    names: string[];
  };
  lookat: {
    supported: boolean;
  };
  poseLimits: {
    maxRotationDeg: number;
  };
  generatedMotion: {
    supportedRoutes: VrmGeneratedRouteId[];
    unsupportedRoutes: Array<{ routeId: VrmGeneratedRouteId; reason: string }>;
    safetyLimits: {
      maxRotationRad: number;
    };
  };
};

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

  const maxRotationDeg = radiansToDegrees(GENERATED_MOTION_MAX_ROTATION_RAD);

  return {
    profileId: 'vrm-runtime-probe-v1',
    backendKind: 'vrm',
    modelFingerprint: deriveModelFingerprint(vrm),
    humanoidBones,
    expressionManagerPresent: Boolean(vrm.expressionManager),
    expressionPresets: {
      present: Boolean(vrm.expressionManager),
      names: detectExpressionPresetNames(vrm),
    },
    lookat: {
      supported: Boolean((vrm as { lookAt?: unknown }).lookAt),
    },
    poseLimits: {
      maxRotationDeg,
    },
    generatedMotion: {
      supportedRoutes,
      unsupportedRoutes,
      safetyLimits: {
        maxRotationRad: degreesToRadians(maxRotationDeg),
      },
    },
  };
}

function deriveModelFingerprint(vrm: VRM): string {
  const bonePresence = VRM_CAPABILITY_REQUIRED_BONES.map((bone) =>
    getVrmBoneNode(vrm, bone) !== null ? '1' : '0',
  ).join('');
  const hasExpressionManager = vrm.expressionManager ? '1' : '0';
  return `vrm:bones=${bonePresence};expr=${hasExpressionManager}`;
}

export function validateVrmCapabilityProfile(profile: VrmCapabilityProfile): void {
  if (profile.backendKind !== 'vrm') {
    throw new Error('VrmCapabilityProfile: backendKind must be vrm');
  }
  if (!profile.profileId.trim()) {
    throw new Error('VrmCapabilityProfile: profileId is required');
  }
  if (!profile.modelFingerprint.trim()) {
    throw new Error('VrmCapabilityProfile: modelFingerprint is required');
  }
  for (const bone of VRM_CAPABILITY_REQUIRED_BONES) {
    if (typeof profile.humanoidBones[bone] !== 'boolean') {
      throw new Error(`VrmCapabilityProfile: humanoidBones.${bone} is required`);
    }
  }
  if (!profile.expressionPresets || typeof profile.expressionPresets.present !== 'boolean') {
    throw new Error('VrmCapabilityProfile: expressionPresets is required');
  }
  if (!Array.isArray(profile.expressionPresets.names)) {
    throw new Error('VrmCapabilityProfile: expressionPresets.names is required');
  }
  if (!profile.lookat || typeof profile.lookat.supported !== 'boolean') {
    throw new Error('VrmCapabilityProfile: lookat is required');
  }
  if (
    !profile.poseLimits
    || !Number.isFinite(profile.poseLimits.maxRotationDeg)
    || profile.poseLimits.maxRotationDeg <= 0
  ) {
    throw new Error('VrmCapabilityProfile: poseLimits.maxRotationDeg is required');
  }
  if (!profile.generatedMotion || !Array.isArray(profile.generatedMotion.supportedRoutes)) {
    throw new Error('VrmCapabilityProfile: generatedMotion.supportedRoutes is required');
  }
  if (!Array.isArray(profile.generatedMotion.unsupportedRoutes)) {
    throw new Error('VrmCapabilityProfile: generatedMotion.unsupportedRoutes is required');
  }
  if (
    !profile.generatedMotion.safetyLimits
    || !Number.isFinite(profile.generatedMotion.safetyLimits.maxRotationRad)
    || profile.generatedMotion.safetyLimits.maxRotationRad <= 0
  ) {
    throw new Error('VrmCapabilityProfile: generatedMotion.safetyLimits.maxRotationRad is required');
  }
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

function detectExpressionPresetNames(vrm: VRM): string[] {
  const manager = vrm.expressionManager as unknown;
  if (!manager || typeof manager !== 'object') {
    return [];
  }
  const record = manager as Record<string, unknown>;
  const candidates = [
    record['expressionMap'],
    record['presetExpressionMap'],
    record['_expressionMap'],
  ];
  for (const candidate of candidates) {
    const names = namesFromExpressionCollection(candidate);
    if (names.length > 0) return names;
  }
  return [
    'neutral',
    'happy',
    'sad',
    'angry',
    'relaxed',
    'surprised',
    'aa',
    'ih',
    'ou',
    'ee',
    'oh',
  ];
}

function namesFromExpressionCollection(value: unknown): string[] {
  if (value instanceof Map) {
    return [...value.keys()].filter((key): key is string => typeof key === 'string' && key.trim().length > 0);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value);
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  }
  return [];
}

function radiansToDegrees(value: number): number {
  return value * (180 / Math.PI);
}

function degreesToRadians(value: number): number {
  return value * (Math.PI / 180);
}

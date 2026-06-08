import type { VRM } from '@pixiv/three-vrm';
import {
  GENERATED_MOTION_MAX_ROTATION_RAD,
  VRM_GENERATED_ROUTE_IDS,
  type VrmGeneratedRouteId,
} from '@nimiplatform/kit/features/avatar/vrm';

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

export type VrmCapabilityProfileEvidenceSource =
  | 'model_manifest'
  | 'runtime_probe'
  | 'static_asset_inspection'
  | 'human_review';

export type VrmCapabilityProfileEvidence = {
  source: VrmCapabilityProfileEvidenceSource;
  observedAt: string;
  validator: string;
};

export type VrmCapabilityProfile = {
  profileId: string;
  backendKind: 'vrm';
  modelFingerprint: string;
  humanoidBones: Record<VrmBoneName, boolean>;
  expressionManagerPresent: boolean;
  generatedMotion: {
    supportedRoutes: VrmGeneratedRouteId[];
    unsupportedRoutes: Array<{ routeId: VrmGeneratedRouteId; reason: string }>;
    safetyLimits: {
      maxRotationRad: number;
    };
  };
  evidence: VrmCapabilityProfileEvidence;
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

  const evidence: VrmCapabilityProfileEvidence = {
    source: 'runtime_probe',
    observedAt: new Date().toISOString(),
    validator: 'vrm-capability-profile-factory-v1',
  };

  return {
    profileId: 'vrm-runtime-probe-v1',
    backendKind: 'vrm',
    modelFingerprint: deriveModelFingerprint(vrm),
    humanoidBones,
    expressionManagerPresent: Boolean(vrm.expressionManager),
    generatedMotion: {
      supportedRoutes,
      unsupportedRoutes,
      safetyLimits: {
        maxRotationRad: GENERATED_MOTION_MAX_ROTATION_RAD,
      },
    },
    evidence,
  };
}

function deriveModelFingerprint(vrm: VRM): string {
  const bonePresence = VRM_CAPABILITY_REQUIRED_BONES.map((bone) =>
    getVrmBoneNode(vrm, bone) !== null ? '1' : '0',
  ).join('');
  const hasExpressionManager = vrm.expressionManager ? '1' : '0';
  return `vrm:bones=${bonePresence};expr=${hasExpressionManager}`;
}

export function validateVrmCapabilityProfileEvidence(evidence: VrmCapabilityProfileEvidence): void {
  if (!evidence.source) {
    throw new Error('VrmCapabilityProfile: evidence.source is required');
  }
  if (!evidence.observedAt) {
    throw new Error('VrmCapabilityProfile: evidence.observedAt is required');
  }
  if (!evidence.validator) {
    throw new Error('VrmCapabilityProfile: evidence.validator is required');
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

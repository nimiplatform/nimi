import type { VRM } from '@pixiv/three-vrm';
import { AnimationClip, NumberKeyframeTrack } from 'three';
import {
  GENERATED_MOTION_MAX_ROTATION_RAD,
  isVrmGeneratedRouteId,
  type GeneratedMotionReasonCode,
  type VrmGeneratedMotionProvider,
  type VrmGeneratedMotionProviderInput,
  type VrmGeneratedMotionProviderResult,
  type VrmGeneratedRouteId,
} from './vrm-generated-motion-contract.js';
import {
  createVrmCapabilityProfile,
  getMissingRouteBones,
  getVrmBoneNode,
  type VrmBoneName,
} from './vrm-capability-profile.js';
import { evaluateAvatarMappingSidecarsForRoute } from './vrm-mapping-sidecar.js';

type Axis = 'x' | 'y' | 'z';

type TrackSpec = {
  bone: VrmBoneName;
  axis: Axis;
  values: number[];
};

type RouteTemplate = {
  duration: number;
  times: number[];
  tracks: TrackSpec[];
};

export type DeterministicVrmGeneratedMotionProviderOptions = {
  mappingSidecars?: readonly unknown[];
};

const ROUTE_TEMPLATES: Readonly<Record<VrmGeneratedRouteId, RouteTemplate>> =
  Object.freeze({
    idle_subtle: {
      duration: 2,
      times: [0, 0.7, 1.4, 2],
      tracks: [
        { bone: 'spine', axis: 'x', values: [0, 0.025, -0.015, 0] },
        { bone: 'head', axis: 'y', values: [0, 0.035, -0.035, 0] },
      ],
    },
    listen_lean: {
      duration: 0.8,
      times: [0, 0.45, 0.8],
      tracks: [
        { bone: 'spine', axis: 'x', values: [0, 0.14, 0.1] },
        { bone: 'head', axis: 'x', values: [0, 0.08, 0.05] },
      ],
    },
    nod_yes: {
      duration: 0.72,
      times: [0, 0.18, 0.36, 0.54, 0.72],
      tracks: [
        { bone: 'head', axis: 'x', values: [0, -0.22, 0.18, -0.1, 0] },
        { bone: 'neck', axis: 'x', values: [0, -0.08, 0.06, -0.04, 0] },
      ],
    },
    shake_no: {
      duration: 0.72,
      times: [0, 0.18, 0.36, 0.54, 0.72],
      tracks: [
        { bone: 'head', axis: 'y', values: [0, 0.25, -0.25, 0.16, 0] },
        { bone: 'neck', axis: 'y', values: [0, 0.08, -0.08, 0.05, 0] },
      ],
    },
    greet_wave: {
      duration: 1.2,
      times: [0, 0.3, 0.6, 0.9, 1.2],
      tracks: [
        { bone: 'spine', axis: 'z', values: [0, 0.04, 0.04, 0.02, 0] },
        { bone: 'rightUpperArm', axis: 'z', values: [0, -1.05, -1.05, -1.05, 0] },
        { bone: 'rightLowerArm', axis: 'x', values: [0, -0.72, -0.66, -0.72, 0] },
        { bone: 'rightHand', axis: 'z', values: [0, 0.28, -0.28, 0.28, 0] },
      ],
    },
  });

// @nimi-authority: rule.nimi.avatar.embodiment.r058
export function createDeterministicVrmGeneratedMotionProvider(
  options: DeterministicVrmGeneratedMotionProviderOptions = {},
): VrmGeneratedMotionProvider<VRM> {
  return {
    generate(input) {
      return generateDeterministicVrmMotion(input, options);
    },
  };
}

export function generateDeterministicVrmMotion(
  input: VrmGeneratedMotionProviderInput<VRM>,
  options: DeterministicVrmGeneratedMotionProviderOptions = {},
): VrmGeneratedMotionProviderResult {
  if (!isVrmGeneratedRouteId(input.routeId)) {
    return fail(input.routeId, 'missing_route');
  }

  const profile = createVrmCapabilityProfile(input.vrm);
  const mappingSupport = evaluateAvatarMappingSidecarsForRoute(
    options.mappingSidecars,
    profile,
    input.routeId,
  );
  if (!mappingSupport.supported) {
    return fail(input.routeId, mappingSidecarReasonToReasonCode(mappingSupport.reason));
  }

  const missing = getMissingRouteBones(input.vrm, input.routeId);
  if (missing.length > 0) {
    return fail(input.routeId, 'unsupported_capability');
  }

  const template = ROUTE_TEMPLATES[input.routeId];
  const intensity = clampIntensity01(input.intensity);
  const tracks: unknown[] = [];

  for (const spec of template.tracks) {
    const node = getVrmBoneNode(input.vrm, spec.bone);
    if (!node) {
      return fail(input.routeId, 'unsupported_capability');
    }
    const trackName = `${node.name || spec.bone}.rotation[${spec.axis}]`;
    const values = spec.values.map((value) =>
      clampRotation(value * intensity, profile.generatedMotion.safetyLimits.maxRotationRad),
    );
    tracks.push(new NumberKeyframeTrack(trackName, template.times, values));
  }

  return {
    status: 'ok',
    clip: new AnimationClip(`nimi.${input.routeId}`, template.duration, tracks as never),
    routeId: input.routeId,
    evidence: {
      routeId: input.routeId,
      providerKind: 'deterministic_vrm',
    },
  };
}

function fail(routeId: string, reasonCode: GeneratedMotionReasonCode): VrmGeneratedMotionProviderResult {
  return {
    status: 'fail_closed',
    routeId,
    reasonCode,
    evidence: {
      routeId,
      providerKind: 'deterministic_vrm',
      reasonCode,
    },
  };
}

function mappingSidecarReasonToReasonCode(reason: string): GeneratedMotionReasonCode {
  if (reason === 'mapping_confidence_below_threshold') {
    return 'mapping_confidence_below_threshold';
  }
  if (
    reason === 'mapping_unconfirmed' ||
    reason === 'mapping_rejected' ||
    reason === 'mapping_manual_confirmation_required'
  ) {
    return 'mapping_unconfirmed';
  }
  if (
    reason === 'route_not_admitted'
  ) {
    return 'missing_route';
  }
  if (
    reason === 'capability_profile_route_unsupported' ||
    reason.startsWith('mapping_target_unknown_bone:') ||
    reason.startsWith('mapping_target_missing_bone:') ||
    reason.startsWith('mapping_target_unsupported_for_vrm:') ||
    reason === 'mapping_target_expression_manager_missing'
  ) {
    return 'unsupported_capability';
  }
  // mapping_backend_kind_mismatch, mapping_profile_id_mismatch, mapping_sidecar_invalid:*, mapping_sidecar_missing
  return 'missing_profile';
}

function clampIntensity01(raw: number | null): number {
  if (raw === null) return 1;
  if (!Number.isFinite(raw)) return 1;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

function clampRotation(raw: number, maxAbs: number): number {
  const safeMax = Math.min(Math.abs(maxAbs), GENERATED_MOTION_MAX_ROTATION_RAD);
  if (raw > safeMax) return safeMax;
  if (raw < -safeMax) return -safeMax;
  return raw;
}

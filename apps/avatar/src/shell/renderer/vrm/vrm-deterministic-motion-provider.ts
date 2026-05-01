import { AnimationClip, NumberKeyframeTrack } from 'three';
import type {
  VrmGeneratedMotionProvider,
  VrmGeneratedMotionProviderInput,
  VrmGeneratedMotionProviderResult,
} from './vrm-generated-motion-runtime.js';
import {
  GENERATED_MOTION_MAX_ROTATION_RAD,
  createVrmCapabilityProfile,
  getMissingRouteBones,
  getVrmBoneNode,
  isVrmGeneratedRouteId,
  type VrmBoneName,
  type VrmGeneratedRouteId,
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

export function createDeterministicVrmGeneratedMotionProvider(
  options: DeterministicVrmGeneratedMotionProviderOptions = {},
): VrmGeneratedMotionProvider {
  return {
    generate(input) {
      return generateDeterministicVrmMotion(input, options);
    },
  };
}

export function generateDeterministicVrmMotion(
  input: VrmGeneratedMotionProviderInput,
  options: DeterministicVrmGeneratedMotionProviderOptions = {},
): VrmGeneratedMotionProviderResult {
  if (!isVrmGeneratedRouteId(input.routeId)) {
    return fail(input.routeId, 'route_not_admitted');
  }

  const profile = createVrmCapabilityProfile(input.vrm);
  const mappingSupport = evaluateAvatarMappingSidecarsForRoute(
    options.mappingSidecars,
    profile,
    input.routeId,
  );
  if (!mappingSupport.supported) {
    return fail(input.routeId, mappingSupport.reason);
  }

  const missing = getMissingRouteBones(input.vrm, input.routeId);
  if (missing.length > 0) {
    return fail(input.routeId, `missing_bones:${missing.join(',')}`);
  }

  const template = ROUTE_TEMPLATES[input.routeId];
  const intensity = clampIntensity01(input.intensity);
  const tracks: unknown[] = [];

  for (const spec of template.tracks) {
    const node = getVrmBoneNode(input.vrm, spec.bone);
    if (!node) {
      return fail(input.routeId, `missing_bones:${spec.bone}`);
    }
    const trackName = `${node.name || spec.bone}.rotation[${spec.axis}]`;
    const values = spec.values.map((value) =>
      clampRotation(value * intensity, profile.safetyLimits.maxRotationRad),
    );
    tracks.push(new NumberKeyframeTrack(trackName, template.times, values));
  }

  return {
    ok: true,
    clip: new AnimationClip(`nimi.${input.routeId}`, template.duration, tracks as never),
    evidence: {
      routeId: input.routeId,
      providerKind: 'deterministic_vrm',
    },
  };
}

function fail(routeId: string, reason: string): VrmGeneratedMotionProviderResult {
  return {
    ok: false,
    reason,
    evidence: {
      routeId,
      providerKind: 'deterministic_vrm',
      reasonCode: reason,
    },
  };
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

import { AvatarDebugProbeKind } from '@nimiplatform/sdk/runtime/generated';
import { describe, expect, it } from 'vitest';
import type { BackendBranch } from '@nimiplatform/kit/features/avatar/headless';
import type { VrmCapabilityProfile } from '../vrm/vrm-capability-profile.js';
import {
  createAvatarDebugSession,
  type AvatarDebugSessionInput,
} from './avatar-debug-session.js';

function backend(kind: 'vrm' | 'live2d'): BackendBranch {
  const base = {
    nominalBounds: {
      width: 360,
      height: 480,
      bodyCenterX: 0.5,
      bodyCenterY: 0.55,
    },
    projection: {
      applyActivity() {},
      applyEmotion() {},
      applyMotion() {},
      applyExpression() {},
      reset() {},
    },
    surface: {
      Component: () => null,
    },
    metadata: () => kind === 'vrm'
      ? {
        model_kind: 'vrm',
        generated_motion_provider: 'deterministic_vrm',
        lipsync_profile_present: true,
      }
      : {
        model_kind: 'live2d',
        compatibility_tier: 'enhanced',
        adapter_id: 'live2d-adapter',
        lipsync_profile_present: true,
      },
    shutdown() {},
  };
  if (kind === 'live2d') {
    return {
      ...base,
      kind,
      live2dExtension: {
        setParameter() {},
      },
    };
  }
  return { ...base, kind };
}

function vrmProfile(): VrmCapabilityProfile {
  return {
    profileId: 'vrm-runtime-probe-v1',
    backendKind: 'vrm',
    humanoidBones: {
      hips: true,
      spine: true,
      chest: true,
      neck: true,
      head: true,
      leftUpperArm: true,
      leftLowerArm: true,
      leftHand: true,
      rightUpperArm: true,
      rightLowerArm: true,
      rightHand: true,
      leftUpperLeg: true,
      leftLowerLeg: true,
      rightUpperLeg: true,
      rightLowerLeg: true,
    },
    expressionManagerPresent: true,
    supportedRoutes: ['idle_subtle', 'listen_lean', 'nod_yes', 'shake_no', 'greet_wave'],
    unsupportedRoutes: [],
    safetyLimits: {
      maxRotationRad: 1.2,
    },
  };
}

function input(probeKind: AvatarDebugProbeKind): AvatarDebugSessionInput {
  return {
    debugSessionId: 'debug-session-1',
    runtimeProbe: {
      probeId: 'probe-1',
      agentId: 'agent-1',
      probeKind,
    },
    avatarInstanceId: 'avatar-1',
    avatarPackageRef: 'avatar-package-ref-1',
    backendCapabilityProfileRef: 'backend-profile-ref-1',
    backendKind: 'vrm',
    backend: backend('vrm'),
    resolverEvidence: {
      packageResolved: true,
      capabilityProfileResolved: true,
    },
    vrmCapabilityProfile: vrmProfile(),
    observedAt: '2026-05-01T00:00:00.000Z',
  };
}

describe('createAvatarDebugSession', () => {
  it('creates Avatar-owned generated motion evidence from a Runtime probe kind', () => {
    const session = createAvatarDebugSession(input(AvatarDebugProbeKind.GENERATED_MOTION));

    expect(session).toMatchObject({
      runtimeProbeId: 'probe-1',
      agentId: 'agent-1',
      backendKind: 'vrm',
      evidence: {
        evidenceKind: 'generated_motion_checked',
        status: 'passed',
        source: 'avatar.backend.vrm',
        reasonCode: null,
      },
    });
    expect(session.evidence.refs.routeIds).toContain('greet_wave');
  });

  it('fails closed when VRM generated motion route support is absent', () => {
    const session = createAvatarDebugSession({
      ...input(AvatarDebugProbeKind.GENERATED_MOTION),
      vrmCapabilityProfile: {
        ...vrmProfile(),
        supportedRoutes: [],
        unsupportedRoutes: [{ routeId: 'greet_wave', reason: 'missing_bones:rightHand' }],
      },
    });

    expect(session.evidence.status).toBe('unsupported');
    expect(session.evidence.reasonCode).toBe('generated_motion_route_support_missing');
    expect(session.evidence.refs.unsupportedRouteIds).toEqual(['greet_wave']);
  });

  it('reports Live2D generated motion as unsupported instead of success', () => {
    const session = createAvatarDebugSession({
      ...input(AvatarDebugProbeKind.GENERATED_MOTION),
      backendKind: 'live2d',
      backend: backend('live2d'),
      vrmCapabilityProfile: null,
    });

    expect(session.evidence.status).toBe('unsupported');
    expect(session.evidence.reasonCode).toBe('generated_motion_not_supported_by_backend');
  });

  it('rejects forbidden raw payload fields recursively', () => {
    expect(() => createAvatarDebugSession({
      ...input(AvatarDebugProbeKind.BACKEND_LOAD),
      resolverEvidence: {
        packageResolved: true,
        capabilityProfileResolved: true,
        raw_provider_output: 'not admitted',
      } as unknown as AvatarDebugSessionInput['resolverEvidence'],
    })).toThrow('forbidden field');
  });

  it('does not invent probe semantics beyond admitted Runtime probe kinds', () => {
    expect(() => createAvatarDebugSession({
      ...input(999 as AvatarDebugProbeKind),
    })).toThrow('probe kind is not admitted');
  });
});

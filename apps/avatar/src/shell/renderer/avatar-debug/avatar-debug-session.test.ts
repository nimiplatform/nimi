import { AvatarDebugProbeKind } from '@nimiplatform/sdk/runtime/wire-types';
import { describe, expect, it } from 'vitest';
import type { BackendBranch } from '../carrier/backend-branch.js';
import type { VrmCapabilityProfile } from '../vrm/vrm-capability-profile.js';
import {
  createAvatarDebugSession,
  evidenceRefsForAvatarDebugSession,
  type AvatarDebugSessionInput,
} from './avatar-debug-session.js';

const LIVE2D_EVIDENCE_PACK = {
  backend_load_evidence_ref: 'avatar.live2d.backend-load:ren',
  live2d_capability_profile_evidence_ref: 'avatar.live2d.capability-profile:ren',
  live2d_route_support_evidence_ref: 'avatar.live2d.route-support:ren',
  live2d_lipsync_evidence_ref: 'avatar.live2d.lipsync:ren:profile:mouth-open-only',
  live2d_hit_region_evidence_ref: 'avatar.live2d.hit-region:ren:alpha_mask_plus_bbox',
  carrier_visual_parameter_lane_diagnostics_ref: 'avatar.live2d.parameter-lane:ren:12345',
  live2d_calibration_ref: 'live2d_calibration_ab12cd34ef56',
} as const;

function backend(
  kind: 'vrm' | 'live2d' | 'nimi2d',
  metadataOverrides: Record<string, unknown> = {},
): BackendBranch {
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
    metadata: () => {
      if (kind === 'vrm') {
        return {
        model_kind: 'vrm',
        generated_motion_provider: 'deterministic_vrm',
        lipsync_profile_present: true,
          ...metadataOverrides,
        };
      }
      if (kind === 'nimi2d') {
        return {
          model_kind: 'nimi2d',
          capability_profile_ref: 'backend-profile-ref-1',
          proven_tier: 'tier-1_agent_basic',
          live_action_lanes: {
            expression: 'supported',
            speech_mouth: 'supported',
            gesture_motion: 'supported',
          },
          ...metadataOverrides,
        };
      }
      return {
        model_kind: 'live2d',
        compatibility_tier: 'enhanced',
        adapter_id: 'live2d-adapter',
        lipsync_profile_present: true,
        ...metadataOverrides,
      };
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
    expressionPresets: {
      present: true,
      names: ['neutral', 'happy', 'sad', 'aa', 'oh'],
    },
    lookat: {
      supported: false,
    },
    poseLimits: {
      maxRotationDeg: 68.75493541569878,
    },
    modelFingerprint: 'vrm:bones=111111111111111;expr=1',
    generatedMotion: {
      supportedRoutes: ['idle_subtle', 'listen_lean', 'nod_yes', 'shake_no', 'greet_wave'],
      unsupportedRoutes: [],
      safetyLimits: {
        maxRotationRad: 1.2,
      },
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
        generatedMotion: {
          supportedRoutes: [],
          unsupportedRoutes: [{ routeId: 'greet_wave', reason: 'missing_bones:rightHand' }],
          safetyLimits: { maxRotationRad: 1.2 },
        },
      },
    });

    expect(session.evidence.status).toBe('unsupported');
    expect(session.evidence.reasonCode).toBe('generated_motion_route_support_missing');
    expect(session.evidence.refs.unsupportedRouteIds).toEqual(['greet_wave']);
  });

  it('fails closed when resolver evidence did not resolve the package descriptor', () => {
    const session = createAvatarDebugSession({
      ...input(AvatarDebugProbeKind.GENERATED_MOTION),
      resolverEvidence: {
        packageResolved: false,
        capabilityProfileResolved: true,
      },
    });

    expect(session.evidence.status).toBe('failed');
    expect(session.evidence.reasonCode).toBe('package_descriptor_not_resolved');
  });

  it('fails closed when observed_at is invalid', () => {
    expect(() => createAvatarDebugSession({
      ...input(AvatarDebugProbeKind.GENERATED_MOTION),
      observedAt: 'not-a-date',
    })).toThrow('observed_at is invalid');
  });

  it('fails closed when capability-profile resolver evidence is missing for capability probes', () => {
    const session = createAvatarDebugSession({
      ...input(AvatarDebugProbeKind.SPEECH_LIPSYNC),
      resolverEvidence: {
        packageResolved: true,
        capabilityProfileResolved: false,
      },
    });

    expect(session.evidence.status).toBe('failed');
    expect(session.evidence.reasonCode).toBe('backend_capability_profile_not_resolved');
  });

  it('fails closed when capability-profile probes only have backend metadata', () => {
    const session = createAvatarDebugSession({
      ...input(AvatarDebugProbeKind.CAPABILITY_PROFILE),
      vrmCapabilityProfile: null,
    });

    expect(session.evidence.status).toBe('failed');
    expect(session.evidence.reasonCode).toBe('vrm_capability_profile_missing');
  });

  it('fails closed when capability-profile probes use placeholder profile ids', () => {
    const session = createAvatarDebugSession({
      ...input(AvatarDebugProbeKind.CAPABILITY_PROFILE),
      vrmCapabilityProfile: {
        ...vrmProfile(),
        profileId: 'placeholder-vrm-profile',
      },
    });

    expect(session.evidence.status).toBe('failed');
    expect(session.evidence.reasonCode).toBe('vrm_capability_profile_missing');
  });

  it('fails closed when capability-profile probes lack an admitted backend profile ref', () => {
    const session = createAvatarDebugSession({
      ...input(AvatarDebugProbeKind.CAPABILITY_PROFILE),
      backendCapabilityProfileRef: null,
    });

    expect(session.evidence.status).toBe('failed');
    expect(session.evidence.reasonCode).toBe('vrm_capability_profile_missing');
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

  it('admits Nimi2D capability and live-action lanes from the active branch', () => {
    for (const probeKind of [
      AvatarDebugProbeKind.CAPABILITY_PROFILE,
      AvatarDebugProbeKind.GENERATED_MOTION,
      AvatarDebugProbeKind.EMOTION_EXPRESSION,
      AvatarDebugProbeKind.SPEECH_LIPSYNC,
    ]) {
      const session = createAvatarDebugSession({
        ...input(probeKind),
        backendKind: 'nimi2d',
        backend: backend('nimi2d'),
        vrmCapabilityProfile: null,
      });

      expect(session.evidence.status).toBe('passed');
      expect(session.evidence.reasonCode).toBeNull();
      expect(session.evidence.source).toBe('avatar.backend.nimi2d');
    }
  });

  it('fails closed when a Nimi2D capability profile or action lane is absent', () => {
    const profileMismatch = createAvatarDebugSession({
      ...input(AvatarDebugProbeKind.CAPABILITY_PROFILE),
      backendKind: 'nimi2d',
      backend: backend('nimi2d', {
        capability_profile_ref: 'another-profile',
      }),
      vrmCapabilityProfile: null,
    });
    expect(profileMismatch.evidence.status).toBe('failed');
    expect(profileMismatch.evidence.reasonCode).toBe('nimi2d_capability_profile_missing');

    const missingMotion = createAvatarDebugSession({
      ...input(AvatarDebugProbeKind.GENERATED_MOTION),
      backendKind: 'nimi2d',
      backend: backend('nimi2d', {
        live_action_lanes: {
          expression: 'supported',
          speech_mouth: 'supported',
          gesture_motion: 'unsupported',
        },
      }),
      vrmCapabilityProfile: null,
    });
    expect(missingMotion.evidence.status).toBe('unsupported');
    expect(missingMotion.evidence.reasonCode).toBe('generated_motion_route_support_missing');
  });

  it('requires parsed Live2D expression inventory before emotion expression success', () => {
    const missingInventory = createAvatarDebugSession({
      ...input(AvatarDebugProbeKind.EMOTION_EXPRESSION),
      backendKind: 'live2d',
      backend: backend('live2d', {
        ...LIVE2D_EVIDENCE_PACK,
        adapter_id: 'live2d-adapter',
      }),
      vrmCapabilityProfile: null,
    });

    expect(missingInventory.evidence.status).toBe('unsupported');
    expect(missingInventory.evidence.reasonCode).toBe('live2d_expression_inventory_missing');

    const session = createAvatarDebugSession({
      ...input(AvatarDebugProbeKind.EMOTION_EXPRESSION),
      backendKind: 'live2d',
      backend: backend('live2d', {
        ...LIVE2D_EVIDENCE_PACK,
        adapter_id: 'live2d-adapter',
        expression_stack_supported: true,
        expression_inventory_ref: 'avatar.live2d.expression-inventory:ren:1234abcd',
      }),
      vrmCapabilityProfile: null,
    });

    expect(session.evidence.status).toBe('passed');
    expect(session.evidence.refs.live2dExpressionInventoryRef)
      .toBe('avatar.live2d.expression-inventory:ren:1234abcd');
  });

  it('carries Live2D carrier visual readiness refs without turning them into Runtime probe semantics', () => {
    const session = createAvatarDebugSession({
      ...input(AvatarDebugProbeKind.BACKEND_LOAD),
      backendKind: 'live2d',
      backend: backend('live2d', {
        ...LIVE2D_EVIDENCE_PACK,
        carrier_visual_evidence_ref: 'avatar.carrier.visual:ren:360x480:123',
        carrier_preview_artifact_ref: 'avatar.carrier.preview-artifact:ren:123',
      }),
      vrmCapabilityProfile: null,
    });

    expect(session.evidence.status).toBe('passed');
    expect(session.evidence.refs.carrierVisualEvidenceRef)
      .toBe('avatar.carrier.visual:ren:360x480:123');
    expect(session.evidence.refs.carrierPreviewArtifactRef)
      .toBe('avatar.carrier.preview-artifact:ren:123');
  });

  it('carries the Live2D backend evidence pack as opaque refs', () => {
    const session = createAvatarDebugSession({
      ...input(AvatarDebugProbeKind.CAPABILITY_PROFILE),
      backendKind: 'live2d',
      backend: backend('live2d', {
        ...LIVE2D_EVIDENCE_PACK,
        carrier_visual_evidence_ref: 'avatar.carrier.visual:ren:360x480:12345',
        carrier_preview_artifact_ref: 'avatar.carrier.preview-artifact:ren:12345',
      }),
      vrmCapabilityProfile: null,
    });

    expect(session.evidence.status).toBe('passed');
    expect(session.evidence.refs).toEqual(expect.objectContaining({
      live2dBackendLoadRef: 'avatar.live2d.backend-load:ren',
      live2dCapabilityProfileRef: 'avatar.live2d.capability-profile:ren',
      live2dRouteSupportRef: 'avatar.live2d.route-support:ren',
      live2dLipsyncEvidenceRef: 'avatar.live2d.lipsync:ren:profile:mouth-open-only',
      live2dHitRegionEvidenceRef: 'avatar.live2d.hit-region:ren:alpha_mask_plus_bbox',
      live2dParameterLaneDiagnosticsRef: 'avatar.live2d.parameter-lane:ren:12345',
      live2dCalibrationRef: 'live2d_calibration_ab12cd34ef56',
    }));
    const evidenceRefs = evidenceRefsForAvatarDebugSession(session);
    expect(evidenceRefs).toEqual(expect.arrayContaining([
      'live2d_backend_load_ref:avatar.live2d.backend-load:ren',
      'live2d_capability_profile_ref:avatar.live2d.capability-profile:ren',
      'live2d_route_support_ref:avatar.live2d.route-support:ren',
      'live2d_lipsync_evidence_ref:avatar.live2d.lipsync:ren:profile:mouth-open-only',
      'live2d_hit_region_ref:avatar.live2d.hit-region:ren:alpha_mask_plus_bbox',
      'live2d_parameter_lane_ref:avatar.live2d.parameter-lane:ren:12345',
      'live2d_calibration_ref:live2d_calibration_ab12cd34ef56',
    ]));
    expect(evidenceRefs.join('\n')).not.toMatch(/\/models|raw_provider_output|token|backend_command/);
  });

  it('requires Live2D visual and hit-region evidence before window hit-region success', () => {
    const missingVisualProof = createAvatarDebugSession({
      ...input(AvatarDebugProbeKind.WINDOW_HIT_REGION),
      backendKind: 'live2d',
      backend: backend('live2d', LIVE2D_EVIDENCE_PACK),
      vrmCapabilityProfile: null,
    });

    expect(missingVisualProof.evidence.status).toBe('failed');
    expect(missingVisualProof.evidence.reasonCode).toBe('live2d_visual_hit_region_evidence_missing');

    const session = createAvatarDebugSession({
      ...input(AvatarDebugProbeKind.WINDOW_HIT_REGION),
      backendKind: 'live2d',
      backend: backend('live2d', {
        ...LIVE2D_EVIDENCE_PACK,
        carrier_visual_evidence_ref: 'avatar.carrier.visual:ren:360x480:12345',
        carrier_preview_artifact_ref: 'avatar.carrier.preview-artifact:ren:12345',
      }),
      vrmCapabilityProfile: null,
    });

    expect(session.evidence.status).toBe('passed');
    expect(evidenceRefsForAvatarDebugSession(session)).toEqual(expect.arrayContaining([
      'avatar_carrier_diagnostics_ref:debug-session-1:carrier_diagnostics_checked',
      'avatar_carrier_visual_ref:avatar.carrier.visual:ren:360x480:12345',
      'avatar_preview_artifact_ref:avatar.carrier.preview-artifact:ren:12345',
      'live2d_hit_region_ref:avatar.live2d.hit-region:ren:alpha_mask_plus_bbox',
    ]));
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

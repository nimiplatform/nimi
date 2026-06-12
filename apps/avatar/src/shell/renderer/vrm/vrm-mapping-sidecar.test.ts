import type { VRM } from '@pixiv/three-vrm';
import { describe, expect, it, vi } from 'vitest';

import { createVrmCapabilityProfile } from './vrm-capability-profile.js';
import {
  evaluateAvatarMappingSidecarSupport,
  normalizeAvatarMappingSidecar,
  parseAvatarMappingSidecarDocument,
} from './vrm-mapping-sidecar.js';

function makeVrm(missing: string[] = []): VRM {
  const missingSet = new Set(missing);
  return {
    expressionManager: { setValue: vi.fn() },
    humanoid: {
      getNormalizedBoneNode(name: string) {
        if (missingSet.has(name)) return null;
        return { name: `${name}Node` };
      },
    },
  } as unknown as VRM;
}

function validSidecar(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sidecar_id: 'sidecar-greet-wave-vrm',
    route_id: 'greet_wave',
    backend_kind: 'vrm',
    profile_id: 'vrm-runtime-probe-v1',
    confidence: 0.94,
    threshold: 0.82,
    manual_confirmation: 'confirmed',
    target_fields: [
      { target_kind: 'humanoid_bone', name: 'spine', role: 'stabilizer' },
      { target_kind: 'humanoid_bone', name: 'rightUpperArm', role: 'wave_source' },
      { target_kind: 'humanoid_bone', name: 'rightLowerArm', role: 'wave_source' },
      { target_kind: 'humanoid_bone', name: 'rightHand', role: 'wave_tip' },
    ],
    evidence: {
      source_kind: 'llm_semantic_match',
      source_fields: ['humanoid.spine', 'humanoid.rightHand'],
      rationale: 'route targets match available humanoid arm bones',
    },
    ...overrides,
  };
}

describe('normalizeAvatarMappingSidecar', () => {
  it('parses mapping-only YAML sidecars with confidence and evidence', () => {
    const sidecar = parseAvatarMappingSidecarDocument(`
sidecar_id: sidecar-greet-wave-vrm
route_id: greet_wave
backend_kind: vrm
profile_id: vrm-runtime-probe-v1
confidence: 0.94
threshold: 0.82
manual_confirmation: confirmed
target_fields:
  - target_kind: humanoid_bone
    name: rightHand
    role: wave_tip
evidence:
  source_kind: llm_semantic_match
  source_fields:
    - humanoid.rightHand
  rationale: route target matches available humanoid hand bone
`);

    expect(sidecar.routeId).toBe('greet_wave');
    expect(sidecar.evidence.sourceKind).toBe('llm_semantic_match');
    expect(sidecar.targetFields).toContainEqual({
      targetKind: 'humanoid_bone',
      name: 'rightHand',
      role: 'wave_tip',
    });
  });

  it('rejects forbidden animation math fields from sidecar input', () => {
    expect(() =>
      normalizeAvatarMappingSidecar({
        ...validSidecar(),
        target_fields: [
          { target_kind: 'humanoid_bone', name: 'rightHand', keyframes: [0, 1] },
        ],
      }),
    ).toThrow(/forbidden field/);
  });

  it('rejects unknown Avatar backend route ids', () => {
    expect(() =>
      normalizeAvatarMappingSidecar(validSidecar({ route_id: 'invented_route' })),
    ).toThrow(/unknown route_id/);
  });

  it('rejects sidecar thresholds below the default confidence floor', () => {
    expect(() =>
      normalizeAvatarMappingSidecar(validSidecar({ threshold: 0.5 })),
    ).toThrow(/threshold must be >= default threshold 0\.82/);
  });

  it('rejects sidecars that omit required threshold', () => {
    const raw = validSidecar();
    delete raw.threshold;
    expect(() => normalizeAvatarMappingSidecar(raw)).toThrow(/threshold must be in \[0, 1\]/);
  });
});

describe('evaluateAvatarMappingSidecarSupport', () => {
  it('supports confirmed high-confidence LLM sidecars with matching profile evidence', () => {
    const profile = createVrmCapabilityProfile(makeVrm());
    const result = evaluateAvatarMappingSidecarSupport(
      normalizeAvatarMappingSidecar(validSidecar()),
      profile,
    );

    expect(result.supported).toBe(true);
  });

  it('fails closed for low-confidence mapping output', () => {
    const profile = createVrmCapabilityProfile(makeVrm());
    const result = evaluateAvatarMappingSidecarSupport(
      normalizeAvatarMappingSidecar(validSidecar({ confidence: 0.5 })),
      profile,
    );

    expect(result).toMatchObject({
      supported: false,
      reason: 'mapping_confidence_below_threshold',
    });
  });

  it('fails closed for unconfirmed LLM semantic matches', () => {
    const profile = createVrmCapabilityProfile(makeVrm());
    const result = evaluateAvatarMappingSidecarSupport(
      normalizeAvatarMappingSidecar(validSidecar({ manual_confirmation: 'unconfirmed' })),
      profile,
    );

    expect(result).toMatchObject({
      supported: false,
      reason: 'mapping_manual_confirmation_required',
    });
  });

  it('fails closed when target field evidence is absent from the capability profile', () => {
    const profile = createVrmCapabilityProfile(makeVrm(['rightHand']));
    const result = evaluateAvatarMappingSidecarSupport(
      normalizeAvatarMappingSidecar(validSidecar()),
      profile,
    );

    expect(result.supported).toBe(false);
    if (!result.supported) {
      expect(result.reason).toBe('capability_profile_route_unsupported');
    }
  });

  it('fails closed when expression target names are not proven by the capability profile', () => {
    const profile = {
      ...createVrmCapabilityProfile(makeVrm()),
      expressionPresets: {
        present: true,
        names: ['neutral'],
      },
    };
    const result = evaluateAvatarMappingSidecarSupport(
      normalizeAvatarMappingSidecar(validSidecar({
        target_fields: [
          { target_kind: 'expression_preset', name: 'happy' },
        ],
      })),
      profile,
    );

    expect(result.supported).toBe(false);
    if (!result.supported) {
      expect(result.reason).toBe('mapping_target_unknown_expression_preset:happy');
    }
  });

  it('fails closed when a sidecar relies on an incomplete capability profile', () => {
    const profile = {
      ...createVrmCapabilityProfile(makeVrm()),
      lookat: undefined,
    };
    const result = evaluateAvatarMappingSidecarSupport(
      normalizeAvatarMappingSidecar(validSidecar()),
      profile as never,
    );

    expect(result.supported).toBe(false);
    if (!result.supported) {
      expect(result.reason).toMatch(/^capability_profile_invalid:/);
    }
  });
});

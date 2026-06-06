import { describe, expect, it } from 'vitest';
import {
  selectRequirementDescriptors,
  summarizeAiModelAggregate,
  type CapabilityEvaluation,
} from '@nimiplatform/kit/core/model-config';
import {
  CANONICAL_CAPABILITY_CATALOG_BY_ID,
  type CanonicalCapabilityDescriptor,
} from '@nimiplatform/kit/core/runtime-capabilities';

function evaluation(capabilityId: string, overrides: Partial<CapabilityEvaluation> = {}): CapabilityEvaluation {
  const descriptor = CANONICAL_CAPABILITY_CATALOG_BY_ID[capabilityId] as CanonicalCapabilityDescriptor;
  return {
    capabilityId,
    descriptor,
    status: null,
    bindingPresent: false,
    ...overrides,
  };
}

describe('summarizeAiModelAggregate', () => {
  it('emits ready + attention counts and selects attention when both present', () => {
    const evaluations: CapabilityEvaluation[] = [
      evaluation('text.generate', { bindingPresent: true, status: { supported: true, tone: 'ready' } }),
      evaluation('audio.synthesize', { status: { supported: false, tone: 'attention' } }),
      evaluation('audio.transcribe'),
    ];
    const summary = summarizeAiModelAggregate(evaluations, {
      ready: '{{count}} ready',
      attention: '{{count}} attention',
      neutral: '{{count}} pending',
    });
    expect(summary.readyCount).toBe(1);
    expect(summary.attentionCount).toBe(1);
    expect(summary.neutralCount).toBe(1);
    expect(summary.statusDot).toBe('attention');
    expect(summary.subtitle).toContain('1 ready');
    expect(summary.subtitle).toContain('1 attention');
    expect(summary.subtitle).not.toContain('pending');
  });

  it('uses neutral subtitle only when no ready or attention capabilities', () => {
    const evaluations: CapabilityEvaluation[] = [
      evaluation('text.generate'),
      evaluation('image.generate'),
    ];
    const summary = summarizeAiModelAggregate(evaluations, {
      ready: '{{count}} ready',
      attention: '{{count}} attention',
      neutral: '{{count}} pending',
    });
    expect(summary.statusDot).toBe('neutral');
    expect(summary.subtitle).toContain('2 pending');
  });
});

describe('selectRequirementDescriptors', () => {
  it('derives visible controls from SDK requirement declarations only', () => {
    const selected = selectRequirementDescriptors(
      {
        requirementId: 'desktop.chat.settings',
        scopeRef: { kind: 'feature', ownerId: 'desktop.chat', surfaceId: 'settings' },
        requiredSlices: [
          {
            requirementSliceId: 'req.text',
            capability: 'text.generate',
            profileSliceRef: 'slice.text',
            readinessPolicy: 'required',
          },
          {
            requirementSliceId: 'req.unknown',
            capability: 'unknown.bogus',
            profileSliceRef: 'slice.unknown',
            readinessPolicy: 'required',
          },
        ],
        optionalSlices: [
          {
            requirementSliceId: 'opt.image',
            capability: 'image.generate',
            profileSliceRef: 'slice.image',
            readinessPolicy: 'optional',
          },
        ],
        setupProjectionPolicy: 'sdk-ai-config-setup-projection',
      },
      CANONICAL_CAPABILITY_CATALOG_BY_ID,
    );
    expect(selected.map((d) => d.capabilityId)).toEqual(['text.generate', 'image.generate']);
  });
});

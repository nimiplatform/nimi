import { describe, expect, it } from 'vitest';
import {
  selectEnabledDescriptors,
  summarizeAiModelAggregate,
  type CapabilityEvaluation,
} from '@nimiplatform/nimi-kit/core/model-config';
import {
  CANONICAL_CAPABILITY_CATALOG_BY_ID,
  type CanonicalCapabilityDescriptor,
} from '@nimiplatform/nimi-kit/core/runtime-capabilities';

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

describe('selectEnabledDescriptors', () => {
  it('drops unknown capability ids and preserves input order', () => {
    const selected = selectEnabledDescriptors(
      ['text.generate', 'unknown.bogus', 'image.generate'],
      CANONICAL_CAPABILITY_CATALOG_BY_ID,
    );
    expect(selected.map((d) => d.capabilityId)).toEqual(['text.generate', 'image.generate']);
  });
});

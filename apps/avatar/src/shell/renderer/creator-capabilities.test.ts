import { describe, expect, it } from 'vitest';
import { deriveCreatorCapabilityReport } from './creator-capabilities.js';
import type { AvatarRuntimeCarrier } from './carrier/avatar-carrier.js';

function carrier(
  kind: 'vrm' | 'live2d',
  metadata: Record<string, unknown>,
  handlerCounts = { activity: 0, event: 0, continuous: 0 },
): AvatarRuntimeCarrier {
  const map = (count: number) =>
    new Map(Array.from({ length: count }, (_, index) => [`handler-${index}`, {}]));
  return {
    model: { modelId: `model-${kind}` },
    registry: {
      activity: map(handlerCounts.activity),
      event: map(handlerCounts.event),
      continuous: map(handlerCounts.continuous),
      config: null,
    },
    backend: {
      kind,
      nominalBounds: { width: 360, height: 640, bodyCenterX: 0.5, bodyCenterY: 0.55 },
      metadata: () => metadata,
      projection: {
        applyActivity() {},
        applyEmotion() {},
        applyMotion() {},
        applyExpression() {},
        reset() {},
      },
      surface: { Component: () => null },
      shutdown() {},
      ...(kind === 'live2d' ? { live2dExtension: { setParameter() {} } } : {}),
    },
    createDebugSession: (() => {
      throw new Error('not needed');
    }) as AvatarRuntimeCarrier['createDebugSession'],
    attachRuntimeDriver: async () => {},
    detachRuntimeDriver: () => {},
    shutdown: () => {},
  } as unknown as AvatarRuntimeCarrier;
}

describe('deriveCreatorCapabilityReport', () => {
  it('reports VRM generated motion, expression, hit region, lipsync, and NAS proof', () => {
    const report = deriveCreatorCapabilityReport(carrier('vrm', {
      generated_motion_routes: ['idle_breath', 'greeting'],
      expression_manager_present: true,
      lipsync_profile_present: true,
      hit_region_strategy: 'alpha_mask_plus_bbox',
    }, { activity: 1, event: 1, continuous: 1 }));

    expect(report?.items.map((item) => [item.id, item.status])).toEqual([
      ['motion', 'passed'],
      ['expression', 'passed'],
      ['hit_region', 'passed'],
      ['lipsync', 'passed'],
      ['nas_handlers', 'passed'],
    ]);
  });

  it('does not claim success when package capability evidence is missing', () => {
    const report = deriveCreatorCapabilityReport(carrier('vrm', {
      generated_motion_routes: [],
      expression_manager_present: false,
      lipsync_profile_present: false,
    }));

    expect(report?.items.find((item) => item.id === 'motion')?.status).toBe('unsupported');
    expect(report?.items.find((item) => item.id === 'expression')?.status).toBe('unsupported');
    expect(report?.items.find((item) => item.id === 'lipsync')?.status).toBe('unsupported');
    expect(report?.items.find((item) => item.id === 'nas_handlers')?.status).toBe('unsupported');
  });

  it('reports Live2D motion and expression from loaded backend metadata', () => {
    const report = deriveCreatorCapabilityReport(carrier('live2d', {
      motion_group_count: 3,
      expression_count: 5,
      lipsync_profile_present: true,
      hit_region_strategy: 'alpha_mask_plus_bbox',
    }));

    expect(report?.items.find((item) => item.id === 'motion')?.proofParams).toEqual({ count: 3 });
    expect(report?.items.find((item) => item.id === 'expression')?.proofParams).toEqual({
      count: 5,
      adapter: 'unknown',
    });
  });
});

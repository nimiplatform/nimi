import { describe, expect, it } from 'vitest';

import {
  resolveAvatarVrmFramingPolicy,
  resolveAvatarVrmFramingResult,
  type AvatarVrmFramingMetrics,
} from '../src/vrm.js';

function createMetrics(input: Partial<AvatarVrmFramingMetrics>): AvatarVrmFramingMetrics {
  const width = input.width ?? 0.9;
  const height = input.height ?? 1.8;
  const depth = input.depth ?? 0.75;
  const minX = input.minX ?? (-width / 2);
  const minY = input.minY ?? (-height / 2);
  const minZ = input.minZ ?? (-depth / 2);
  const maxX = input.maxX ?? (width / 2);
  const maxY = input.maxY ?? (height / 2);
  const maxZ = input.maxZ ?? (depth / 2);
  const centerX = input.centerX ?? ((minX + maxX) / 2);
  const centerY = input.centerY ?? ((minY + maxY) / 2);
  const centerZ = input.centerZ ?? ((minZ + maxZ) / 2);
  return {
    width,
    height,
    depth,
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    centerX,
    centerY,
    centerZ,
    silhouetteAspect: input.silhouetteAspect ?? (height / width),
    widthRatio: input.widthRatio ?? (width / height),
  };
}

describe('avatar vrm framing helpers', () => {
  it('keeps tall portrait assets on the full-body rail', () => {
    expect(resolveAvatarVrmFramingPolicy({
      railWidth: 360,
      railHeight: 820,
      metrics: createMetrics({
        width: 0.86,
        height: 2.9,
        depth: 0.72,
      }),
    }).mode).toBe('full-body-tall');
  });

  it('keeps broad portrait assets width-protected', () => {
    expect(resolveAvatarVrmFramingPolicy({
      railWidth: 360,
      railHeight: 820,
      metrics: createMetrics({
        width: 1.18,
        height: 1.9,
        depth: 0.98,
      }),
    }).mode).toBe('broad-portrait');
  });

  it('anchors the model top while preserving the floor guard', () => {
    const framing = resolveAvatarVrmFramingResult({
      railWidth: 360,
      railHeight: 820,
      metrics: createMetrics({
        width: 0.9,
        height: 1.8,
        depth: 0.75,
        minY: -0.9,
        maxY: 0.9,
      }),
    });
    expect(framing.policy.mode).toBe('upper-body-portrait');
    expect(framing.positionZ).toBeCloseTo(-0.16);
    expect(framing.scale).toBeCloseTo(2.72 / 1.8);
  });

  it('returns a chat-focus bust crop in portrait rails when intent is chat-focus', () => {
    const policy = resolveAvatarVrmFramingPolicy({
      railWidth: 320,
      railHeight: 820,
      metrics: createMetrics({
        width: 0.9,
        height: 1.8,
        depth: 0.75,
      }),
      intent: 'chat-focus',
    });
    expect(policy.mode).toBe('chat-focus');
    expect(policy.selectionReason).toBe('chat-focus-intent');
    expect(policy.fitHeight).toBe(3.8);
    expect(policy.fitWidth).toBe(2.4);
    expect(policy.targetTop).toBe(1.18);
  });

  it('chat-focus intent keeps default framing on landscape rails', () => {
    expect(resolveAvatarVrmFramingPolicy({
      railWidth: 920,
      railHeight: 620,
      metrics: createMetrics({
        width: 0.9,
        height: 1.8,
        depth: 0.75,
      }),
      intent: 'chat-focus',
    }).mode).toBe('default');
  });
});

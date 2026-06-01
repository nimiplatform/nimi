import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  measureAvatarVrmFramingMetrics,
  resolveAvatarVrmFramingFromScene,
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

function createSceneFromBoxes(
  boxes: Array<{ width: number; height: number; depth: number; x?: number; y?: number; z?: number }>,
): unknown {
  const scene = new THREE.Group();
  for (const box of boxes) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(box.width, box.height, box.depth),
      new THREE.MeshBasicMaterial(),
    );
    mesh.position.set(box.x ?? 0, box.y ?? 0, box.z ?? 0);
    scene.add(mesh);
  }
  scene.updateMatrixWorld(true);
  return scene;
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

  it('normalizes invalid rail sizes before classification', () => {
    const policy = resolveAvatarVrmFramingPolicy({
      railWidth: 0,
      railHeight: Number.NaN,
      metrics: createMetrics({
        width: 0.9,
        height: 1.8,
        depth: 0.75,
      }),
    });

    expect(policy.mode).toBe('upper-body-portrait');
    expect(policy.selectionReason).toBe('portrait-default');
  });

  it('measures fallback metrics for empty scene graphs', () => {
    const metrics = measureAvatarVrmFramingMetrics(new THREE.Group());

    expect(metrics.width).toBe(0.9);
    expect(metrics.height).toBe(1.8);
    expect(metrics.depth).toBe(0.75);
    expect(metrics.centerX).toBe(0);
    expect(metrics.centerY).toBe(0);
    expect(metrics.centerZ).toBe(0);
    expect(metrics.silhouetteAspect).toBeCloseTo(2);
    expect(metrics.widthRatio).toBeCloseTo(0.5);
  });

  it('measures grouped world-space bounds from scene geometry', () => {
    const scene = createSceneFromBoxes([
      { width: 0.8, height: 1.6, depth: 0.6, x: 0.2, y: 0.8, z: -0.1 },
      { width: 0.4, height: 0.4, depth: 0.2, x: 0.9, y: 0.2, z: 0.15 },
    ]);
    const metrics = measureAvatarVrmFramingMetrics(scene);

    expect(metrics.minX).toBeCloseTo(-0.2);
    expect(metrics.maxX).toBeCloseTo(1.1);
    expect(metrics.width).toBeCloseTo(1.3);
    expect(metrics.minY).toBeCloseTo(0);
    expect(metrics.maxY).toBeCloseTo(1.6);
    expect(metrics.height).toBeCloseTo(1.6);
    expect(metrics.centerX).toBeCloseTo(0.45);
    expect(metrics.centerY).toBeCloseTo(0.8);
    expect(metrics.centerZ).toBeCloseTo(-0.075);
    expect(metrics.widthRatio).toBeCloseTo(1.3 / 1.6);
  });

  it('classifies measured scene geometry deterministically', () => {
    const broadScene = createSceneFromBoxes([
      { width: 0.8, height: 1.6, depth: 0.6, x: 0.2, y: 0.8, z: -0.1 },
      { width: 0.4, height: 0.4, depth: 0.2, x: 0.9, y: 0.2, z: 0.15 },
    ]);
    const tallScene = createSceneFromBoxes([
      { width: 0.72, height: 2.4, depth: 0.62, x: 0, y: 1.2, z: 0.04 },
    ]);

    const broad = resolveAvatarVrmFramingFromScene({
      railWidth: 360,
      railHeight: 820,
      scene: broadScene,
    });
    const tall = resolveAvatarVrmFramingFromScene({
      railWidth: 360,
      railHeight: 820,
      scene: tallScene,
    });

    expect(broad.policy.mode).toBe('broad-portrait');
    expect(broad.policy.selectionReason).toBe('width-ratio-threshold');
    expect(broad.metrics.width).toBeCloseTo(1.3);
    expect(broad.metrics.height).toBeCloseTo(1.6);
    expect(tall.policy.mode).toBe('full-body-tall');
    expect(tall.policy.selectionReason).toBe('silhouette-aspect-threshold');
    expect(tall.metrics.silhouetteAspect).toBeCloseTo(2.4 / 0.72);
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

  it('returns a stronger bust crop for bottom companion intent on landscape rails', () => {
    const policy = resolveAvatarVrmFramingPolicy({
      railWidth: 920,
      railHeight: 360,
      metrics: createMetrics({
        width: 0.9,
        height: 1.8,
        depth: 0.75,
      }),
      intent: 'bottom-companion',
    });
    expect(policy.mode).toBe('chat-focus');
    expect(policy.selectionReason).toBe('chat-focus-intent');
    expect(policy.fitHeight).toBe(4.8);
    expect(policy.targetTop).toBe(1.28);
  });

  it('returns a side-stage presence crop for scene placement', () => {
    const policy = resolveAvatarVrmFramingPolicy({
      railWidth: 420,
      railHeight: 920,
      metrics: createMetrics({
        width: 0.9,
        height: 1.8,
        depth: 0.75,
      }),
      intent: 'scene-presence',
    });
    expect(policy.mode).toBe('chat-focus');
    expect(policy.selectionReason).toBe('chat-focus-intent');
    expect(policy.fitHeight).toBe(3.25);
    expect(policy.fitWidth).toBe(2.12);
    expect(policy.targetTop).toBe(1.12);
  });
});

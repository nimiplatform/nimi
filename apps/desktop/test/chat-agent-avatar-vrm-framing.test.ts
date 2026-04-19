import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  measureChatAgentAvatarVrmFramingMetrics,
  resolveChatAgentAvatarVrmFramingPolicy,
  resolveChatAgentAvatarVrmFramingFromScene,
  resolveChatAgentAvatarVrmFramingResult,
  type ChatAgentAvatarVrmFramingMetrics,
} from '../src/shell/renderer/features/chat/chat-agent-avatar-vrm-framing';

function createMetrics(input: Partial<ChatAgentAvatarVrmFramingMetrics>): ChatAgentAvatarVrmFramingMetrics {
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

function assertApprox(actual: number, expected: number, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
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

test('vrm framing policy keeps tall portrait assets on a full-body framing rail', () => {
  assert.deepEqual(
    resolveChatAgentAvatarVrmFramingPolicy({
      railWidth: 360,
      railHeight: 820,
      metrics: createMetrics({
        width: 0.86,
        height: 2.9,
        depth: 0.72,
      }),
    }),
    {
      mode: 'full-body-tall',
      selectionReason: 'silhouette-aspect-threshold',
      fitHeight: 2.94,
      fitWidth: 1.88,
      fitDepth: 1.5,
      targetTop: 1.52,
      minBottom: -1.98,
      zOffset: -0.18,
    },
  );
});

test('vrm framing policy keeps broad portrait assets on a width-protected framing rail', () => {
  assert.deepEqual(
    resolveChatAgentAvatarVrmFramingPolicy({
      railWidth: 360,
      railHeight: 820,
      metrics: createMetrics({
        width: 1.18,
        height: 1.9,
        depth: 0.98,
      }),
    }),
    {
      mode: 'broad-portrait',
      selectionReason: 'width-ratio-threshold',
      fitHeight: 2.68,
      fitWidth: 1.72,
      fitDepth: 1.42,
      targetTop: 1.48,
      minBottom: -1.88,
      zOffset: -0.12,
    },
  );
});

test('vrm framing policy keeps balanced portrait assets on a tighter upper-body composition', () => {
  assert.deepEqual(
    resolveChatAgentAvatarVrmFramingPolicy({
      railWidth: 360,
      railHeight: 820,
      metrics: createMetrics({
        width: 0.9,
        height: 1.8,
        depth: 0.75,
      }),
    }),
    {
      mode: 'upper-body-portrait',
      selectionReason: 'portrait-default',
      fitHeight: 2.72,
      fitWidth: 1.9,
      fitDepth: 1.5,
      targetTop: 1.46,
      minBottom: -1.78,
      zOffset: -0.16,
    },
  );
});

test('vrm framing policy treats threshold-boundary portrait assets deterministically', () => {
  assert.equal(
    resolveChatAgentAvatarVrmFramingPolicy({
      railWidth: 360,
      railHeight: 820,
      metrics: createMetrics({
        width: 1,
        height: 2.6,
        depth: 0.82,
      }),
    }).mode,
    'full-body-tall',
  );

  assert.equal(
    resolveChatAgentAvatarVrmFramingPolicy({
      railWidth: 360,
      railHeight: 820,
      metrics: createMetrics({
        width: 1.044,
        height: 1.8,
        depth: 0.82,
      }),
    }).mode,
    'broad-portrait',
  );
});

test('vrm framing policy normalizes invalid rail sizes before classification', () => {
  const policy = resolveChatAgentAvatarVrmFramingPolicy({
    railWidth: 0,
    railHeight: Number.NaN,
    metrics: createMetrics({
      width: 0.9,
      height: 1.8,
      depth: 0.75,
    }),
  });

  assert.equal(policy.mode, 'upper-body-portrait');
  assert.equal(policy.selectionReason, 'portrait-default');
});

test('vrm framing metrics fall back deterministically for empty scene graphs', () => {
  const metrics = measureChatAgentAvatarVrmFramingMetrics(new THREE.Group());

  assert.equal(metrics.width, 0.9);
  assert.equal(metrics.height, 1.8);
  assert.equal(metrics.depth, 0.75);
  assert.equal(metrics.centerX, 0);
  assert.equal(metrics.centerY, 0);
  assert.equal(metrics.centerZ, 0);
  assertApprox(metrics.silhouetteAspect, 2);
  assertApprox(metrics.widthRatio, 0.5);
});

test('vrm framing metrics measure grouped world-space bounds from scene geometry', () => {
  const scene = createSceneFromBoxes([
    { width: 0.8, height: 1.6, depth: 0.6, x: 0.2, y: 0.8, z: -0.1 },
    { width: 0.4, height: 0.4, depth: 0.2, x: 0.9, y: 0.2, z: 0.15 },
  ]);
  const metrics = measureChatAgentAvatarVrmFramingMetrics(scene);

  assertApprox(metrics.minX, -0.2);
  assertApprox(metrics.maxX, 1.1);
  assertApprox(metrics.width, 1.3);
  assertApprox(metrics.minY, 0);
  assertApprox(metrics.maxY, 1.6);
  assertApprox(metrics.height, 1.6);
  assertApprox(metrics.centerX, 0.45);
  assertApprox(metrics.centerY, 0.8);
  assertApprox(metrics.centerZ, -0.075);
  assertApprox(metrics.widthRatio, 1.3 / 1.6);
});

test('vrm framing result anchors the model top while preserving a floor guard', () => {
  const framing = resolveChatAgentAvatarVrmFramingResult({
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

  assert.equal(framing.policy.mode, 'upper-body-portrait');
  assert.equal(framing.policy.selectionReason, 'portrait-default');
  assert.equal(framing.railWidth, 360);
  assert.equal(framing.railHeight, 820);
  assertApprox(framing.railAspect, 820 / 360);
  assert.equal(framing.railIsPortrait, true);
  assertApprox(framing.scale, 2.72 / 1.8);
  assertApprox(framing.positionY, 1.46 - 0.9 * framing.scale);
  assertApprox(framing.positionZ, -0.16);
});

test('vrm framing result keeps normalized rail posture consistent with policy selection', () => {
  const framing = resolveChatAgentAvatarVrmFramingResult({
    railWidth: 0,
    railHeight: Number.NaN,
    metrics: createMetrics({
      width: 0.9,
      height: 1.8,
      depth: 0.75,
    }),
  });

  assert.equal(framing.policy.mode, 'upper-body-portrait');
  assert.equal(framing.policy.selectionReason, 'portrait-default');
  assert.equal(framing.railWidth, 360);
  assert.equal(framing.railHeight, 820);
  assert.equal(framing.railIsPortrait, true);
});

test('vrm framing result preserves live portrait rail heights below the old canonical floor', () => {
  const shortRailFraming = resolveChatAgentAvatarVrmFramingResult({
    railWidth: 320,
    railHeight: 560,
    metrics: createMetrics({
      width: 0.9,
      height: 1.8,
      depth: 0.75,
    }),
    intent: 'chat-focus',
  });
  const tallRailFraming = resolveChatAgentAvatarVrmFramingResult({
    railWidth: 320,
    railHeight: 720,
    metrics: createMetrics({
      width: 0.9,
      height: 1.8,
      depth: 0.75,
    }),
    intent: 'chat-focus',
  });

  assert.equal(shortRailFraming.policy.mode, 'chat-focus');
  assert.equal(tallRailFraming.policy.mode, 'chat-focus');
  assert.equal(shortRailFraming.railWidth, 320);
  assert.equal(shortRailFraming.railHeight, 560);
  assert.equal(tallRailFraming.railWidth, 320);
  assert.equal(tallRailFraming.railHeight, 720);
  assert.notEqual(shortRailFraming.railHeight, tallRailFraming.railHeight);
  assertApprox(shortRailFraming.railAspect, 560 / 320);
  assertApprox(tallRailFraming.railAspect, 720 / 320);
});

test('vrm framing from measured scene geometry classifies broad portrait assets deterministically', () => {
  const scene = createSceneFromBoxes([
    { width: 0.8, height: 1.6, depth: 0.6, x: 0.2, y: 0.8, z: -0.1 },
    { width: 0.4, height: 0.4, depth: 0.2, x: 0.9, y: 0.2, z: 0.15 },
  ]);
  const framing = resolveChatAgentAvatarVrmFramingFromScene({
    railWidth: 360,
    railHeight: 820,
    scene,
  });

  assert.equal(framing.policy.mode, 'broad-portrait');
  assert.equal(framing.policy.selectionReason, 'width-ratio-threshold');
  assertApprox(framing.metrics.width, 1.3);
  assertApprox(framing.metrics.height, 1.6);
  assertApprox(framing.positionX, -0.45 * framing.scale);
  assertApprox(framing.positionZ, 0.075 * framing.scale - 0.12);
});

test('vrm framing from measured scene geometry classifies tall portrait assets deterministically', () => {
  const scene = createSceneFromBoxes([
    { width: 0.72, height: 2.4, depth: 0.62, x: 0, y: 1.2, z: 0.04 },
  ]);
  const framing = resolveChatAgentAvatarVrmFramingFromScene({
    railWidth: 360,
    railHeight: 820,
    scene,
  });

  assert.equal(framing.policy.mode, 'full-body-tall');
  assert.equal(framing.policy.selectionReason, 'silhouette-aspect-threshold');
  assertApprox(framing.metrics.silhouetteAspect, 2.4 / 0.72);
  assertApprox(framing.positionX, 0);
  assertApprox(framing.positionZ, -0.04 * framing.scale - 0.18);
});

test('vrm framing from measured scene geometry classifies balanced portrait assets deterministically', () => {
  const scene = createSceneFromBoxes([
    { width: 0.9, height: 1.8, depth: 0.75, x: 0, y: 0.9, z: -0.03 },
  ]);
  const framing = resolveChatAgentAvatarVrmFramingFromScene({
    railWidth: 360,
    railHeight: 820,
    scene,
  });

  assert.equal(framing.policy.mode, 'upper-body-portrait');
  assert.equal(framing.policy.selectionReason, 'portrait-default');
  assertApprox(framing.metrics.widthRatio, 0.5);
  assertApprox(framing.positionX, 0);
  assertApprox(framing.positionZ, 0.03 * framing.scale - 0.16);
});

test('vrm framing from measured scene geometry falls back to default in landscape rails', () => {
  const scene = createSceneFromBoxes([
    { width: 0.9, height: 1.8, depth: 0.75, x: 0.08, y: 0.9, z: -0.03 },
  ]);
  const framing = resolveChatAgentAvatarVrmFramingFromScene({
    railWidth: 920,
    railHeight: 620,
    scene,
  });

  assert.equal(framing.policy.mode, 'default');
  assert.equal(framing.policy.selectionReason, 'landscape-default');
  assert.equal(framing.railIsPortrait, false);
  assertApprox(framing.positionX, -0.08 * framing.scale);
  assertApprox(framing.positionZ, 0.03 * framing.scale - 0.18);
});

test('vrm framing result falls back to default composition in landscape rails', () => {
  const framing = resolveChatAgentAvatarVrmFramingResult({
    railWidth: 920,
    railHeight: 620,
    metrics: createMetrics({
      width: 0.94,
      height: 1.84,
      depth: 0.78,
      centerX: 0.08,
      centerZ: -0.03,
    }),
  });

  assert.equal(framing.policy.mode, 'default');
  assert.equal(framing.policy.selectionReason, 'landscape-default');
  assert.equal(framing.railIsPortrait, false);
  assertApprox(framing.positionX, -0.08 * framing.scale);
  assertApprox(framing.positionZ, 0.03 * framing.scale - 0.18);
});

test('vrm framing policy returns chat-focus bust crop in portrait rails when intent is chat-focus', () => {
  assert.deepEqual(
    resolveChatAgentAvatarVrmFramingPolicy({
      railWidth: 320,
      railHeight: 820,
      metrics: createMetrics({
        width: 0.9,
        height: 1.8,
        depth: 0.75,
      }),
      intent: 'chat-focus',
    }),
    {
      mode: 'chat-focus',
      selectionReason: 'chat-focus-intent',
      fitHeight: 3.8,
      fitWidth: 2.4,
      fitDepth: 2,
      targetTop: 1.18,
      minBottom: -5,
      zOffset: -0.22,
    },
  );
});

test('vrm framing result keeps chat-focus bust composition on resized portrait rails', () => {
  const compactRailFraming = resolveChatAgentAvatarVrmFramingResult({
    railWidth: 320,
    railHeight: 560,
    metrics: createMetrics({
      width: 0.9,
      height: 1.8,
      depth: 0.75,
      minY: -0.9,
      maxY: 0.9,
    }),
    intent: 'chat-focus',
  });
  const expandedRailFraming = resolveChatAgentAvatarVrmFramingResult({
    railWidth: 320,
    railHeight: 760,
    metrics: createMetrics({
      width: 0.9,
      height: 1.8,
      depth: 0.75,
      minY: -0.9,
      maxY: 0.9,
    }),
    intent: 'chat-focus',
  });

  assert.equal(compactRailFraming.policy.mode, 'chat-focus');
  assert.equal(expandedRailFraming.policy.mode, 'chat-focus');
  assertApprox(compactRailFraming.scale, 3.8 / 1.8);
  assertApprox(expandedRailFraming.scale, 3.8 / 1.8);
  assertApprox(compactRailFraming.positionY, expandedRailFraming.positionY);
  assertApprox(compactRailFraming.positionZ, expandedRailFraming.positionZ);
});

test('vrm framing policy chat-focus intent overrides tall silhouette thresholds in portrait rails', () => {
  assert.equal(
    resolveChatAgentAvatarVrmFramingPolicy({
      railWidth: 320,
      railHeight: 820,
      metrics: createMetrics({
        width: 0.86,
        height: 2.9,
        depth: 0.72,
      }),
      intent: 'chat-focus',
    }).mode,
    'chat-focus',
  );
});

test('vrm framing policy chat-focus intent falls back to default framing on landscape rails', () => {
  assert.equal(
    resolveChatAgentAvatarVrmFramingPolicy({
      railWidth: 920,
      railHeight: 620,
      metrics: createMetrics({
        width: 0.9,
        height: 1.8,
        depth: 0.75,
      }),
      intent: 'chat-focus',
    }).mode,
    'default',
  );
});

test('vrm framing-from-scene threads chat-focus intent into the resolved policy', () => {
  const scene = createSceneFromBoxes([
    { width: 0.9, height: 1.8, depth: 0.75, x: 0, y: 0.9, z: -0.03 },
  ]);
  const framing = resolveChatAgentAvatarVrmFramingFromScene({
    railWidth: 320,
    railHeight: 820,
    scene,
    intent: 'chat-focus',
  });

  assert.equal(framing.policy.mode, 'chat-focus');
  assert.equal(framing.policy.selectionReason, 'chat-focus-intent');
  assert.equal(framing.railIsPortrait, true);
});

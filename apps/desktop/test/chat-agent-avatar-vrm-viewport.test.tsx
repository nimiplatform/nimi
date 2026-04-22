import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  collectChatAgentAvatarVrmSceneResourceCounts,
  createChatAgentAvatarVrmDiagnostic,
  resolveChatAgentAvatarVrmEffectiveLoadState,
  resolveChatAgentAvatarVrmViewportStatus,
} from '../src/shell/renderer/features/chat/chat-agent-avatar-vrm-viewport.js';
import { resolveChatAgentAvatarVrmFramingViewportSize } from '../src/shell/renderer/features/chat/chat-agent-avatar-vrm-runtime.js';

test('vrm effective load state fails closed against a stale ready asset during asset switch churn', () => {
  const state = resolveChatAgentAvatarVrmEffectiveLoadState({
    assetRef: 'https://cdn.nimi.test/avatars/next.vrm',
    desktopAssetRef: null,
    networkAssetUrl: null,
    resolvedAsset: {
      assetRef: 'https://cdn.nimi.test/avatars/previous.vrm',
      url: 'https://cdn.nimi.test/avatars/previous.vrm',
      arrayBuffer: null,
    },
    loadedVrm: {
      status: 'ready',
      assetRef: 'https://cdn.nimi.test/avatars/previous.vrm',
      vrm: {} as never,
      error: null,
    },
  });

  assert.deepEqual(state, {
    status: 'idle',
    error: null,
    assetUrl: null,
  });
});

test('vrm effective load state suppresses a stale error while the next network asset is loading', () => {
  const state = resolveChatAgentAvatarVrmEffectiveLoadState({
    assetRef: 'https://cdn.nimi.test/avatars/next.vrm',
    desktopAssetRef: null,
    networkAssetUrl: 'https://cdn.nimi.test/avatars/next.vrm',
    resolvedAsset: {
      assetRef: 'https://cdn.nimi.test/avatars/previous.vrm',
      url: 'https://cdn.nimi.test/avatars/previous.vrm',
      arrayBuffer: null,
    },
    loadedVrm: {
      status: 'error',
      assetRef: 'https://cdn.nimi.test/avatars/previous.vrm',
      vrm: null,
      error: 'Previous VRM failed closed.',
    },
  });

  assert.deepEqual(state, {
    status: 'loading',
    error: null,
    assetUrl: 'https://cdn.nimi.test/avatars/next.vrm',
  });
});

test('vrm effective load state tears down to idle when the current asset no longer resolves', () => {
  const state = resolveChatAgentAvatarVrmEffectiveLoadState({
    assetRef: '',
    desktopAssetRef: null,
    networkAssetUrl: null,
    resolvedAsset: {
      assetRef: 'https://cdn.nimi.test/avatars/previous.vrm',
      url: 'https://cdn.nimi.test/avatars/previous.vrm',
      arrayBuffer: null,
    },
    loadedVrm: {
      status: 'ready',
      assetRef: 'https://cdn.nimi.test/avatars/previous.vrm',
      vrm: {} as never,
      error: null,
    },
  });

  assert.deepEqual(state, {
    status: 'idle',
    error: null,
    assetUrl: null,
  });
});

test('vrm viewport status stays loading while a ready asset waits for host recovery', () => {
  const status = resolveChatAgentAvatarVrmViewportStatus({
    loadedStatus: 'ready',
    loadedError: null,
    hostRenderable: true,
    runtimeLifecycle: {
      phase: 'recovering',
      reason: 'webgl-context-lost',
      attemptCount: 1,
      error: null,
    },
  });

  assert.deepEqual(status, {
    status: 'loading',
    error: null,
  });
});

test('vrm viewport status stays loading while a ready asset waits for a renderable host', () => {
  const status = resolveChatAgentAvatarVrmViewportStatus({
    loadedStatus: 'ready',
    loadedError: null,
    hostRenderable: false,
    runtimeLifecycle: {
      phase: 'stable',
      reason: null,
      attemptCount: 0,
      error: null,
    },
  });

  assert.deepEqual(status, {
    status: 'loading',
    error: null,
  });
});

test('vrm framing viewport size uses the current renderable host metrics directly', () => {
  assert.deepEqual(
    resolveChatAgentAvatarVrmFramingViewportSize({
      currentHostMetrics: {
        width: 320,
        height: 560,
        renderable: true,
      },
      lastRenderableSize: {
        width: 320,
        height: 720,
      },
    }),
    {
      width: 320,
      height: 560,
    },
  );
});

test('vrm framing viewport size preserves the last renderable size through transient host collapse', () => {
  assert.deepEqual(
    resolveChatAgentAvatarVrmFramingViewportSize({
      currentHostMetrics: {
        width: 320,
        height: 2,
        renderable: false,
      },
      lastRenderableSize: {
        width: 320,
        height: 680,
      },
    }),
    {
      width: 320,
      height: 680,
    },
  );
});

test('vrm framing viewport size fails closed when no renderable host size has been observed yet', () => {
  assert.deepEqual(
    resolveChatAgentAvatarVrmFramingViewportSize({
      currentHostMetrics: {
        width: 320,
        height: 2,
        renderable: false,
      },
      lastRenderableSize: null,
    }),
    {
      width: 0,
      height: 0,
    },
  );
});

test('vrm diagnostic preserves ready-stage recovery details when the renderer host degrades', () => {
  const diagnostic = createChatAgentAvatarVrmDiagnostic({
    assetRef: 'https://cdn.nimi.test/avatars/airi.vrm',
    assetLabel: 'Airi VRM',
    desktopAssetRef: null,
    assetUrl: 'https://cdn.nimi.test/avatars/airi.vrm',
    networkAssetUrl: 'https://cdn.nimi.test/avatars/airi.vrm',
    posterUrl: 'https://cdn.nimi.test/avatars/airi.png',
    loadedStatus: 'ready',
    loadedError: null,
    status: 'loading',
    error: null,
    attentionActive: true,
    recoveryAttemptCount: 1,
    recoveryReason: 'webgl-context-lost',
    resizePosture: 'tracked-host-size',
    viewportWidth: 320,
    viewportHeight: 480,
    hostRenderable: true,
    canvasEpoch: 2,
  });

  assert.equal(diagnostic.stage, 'ready');
  assert.equal(diagnostic.status, 'loading');
  assert.equal(diagnostic.recoveryReason, 'webgl-context-lost');
  assert.equal(diagnostic.recoveryAttemptCount, 1);
  assert.equal(diagnostic.viewportWidth, 320);
  assert.equal(diagnostic.canvasEpoch, 2);
});

test('vrm diagnostic advances network resources into vrm-load once bytes are resolved', () => {
  const diagnostic = createChatAgentAvatarVrmDiagnostic({
    assetRef: 'https://cdn.nimi.test/avatars/sample.vrm',
    assetLabel: 'Sample VRM',
    desktopAssetRef: null,
    assetUrl: null,
    assetResolved: true,
    networkAssetUrl: 'https://cdn.nimi.test/avatars/sample.vrm',
    posterUrl: null,
    loadedStatus: 'loading',
    loadedError: null,
    status: 'loading',
    error: null,
    attentionActive: false,
    resizePosture: 'tracked-host-size',
    viewportWidth: 320,
    viewportHeight: 480,
    hostRenderable: true,
    canvasEpoch: 1,
  });

  assert.equal(diagnostic.stage, 'vrm-load');
  assert.equal(diagnostic.source, 'network');
});

test('vrm scene resource counts collect unique geometry material and texture totals', () => {
  const scene = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const meshA = new THREE.Mesh(geometry, material);
  const meshB = new THREE.Mesh(geometry, material);
  const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  skinned.morphTargetInfluences = [0.2, 0.4];
  scene.add(meshA, meshB, skinned);

  assert.deepEqual(collectChatAgentAvatarVrmSceneResourceCounts(scene), {
    objectCount: 4,
    meshCount: 3,
    skinnedMeshCount: 1,
    geometryCount: 2,
    materialCount: 2,
    textureCount: 1,
    morphTargetCount: 2,
  });
});

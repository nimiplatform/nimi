import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as THREE from 'three';

import ChatAgentAvatarVrmViewport, {
  collectChatAgentAvatarVrmSceneResourceCounts,
  createChatAgentAvatarVrmDiagnostic,
  resolveChatAgentAvatarVrmEffectiveLoadState,
  resolveChatAgentAvatarVrmViewportStatus,
} from '../src/shell/renderer/features/chat/chat-agent-avatar-vrm-viewport.js';

test('vrm effective load state fails closed against a stale ready asset during asset switch churn', () => {
  const state = resolveChatAgentAvatarVrmEffectiveLoadState({
    assetRef: 'desktop-avatar://resource-2/next.vrm',
    desktopAssetRef: {
      resourceId: 'resource-2',
      filename: 'next.vrm',
    },
    networkAssetUrl: null,
    resolvedAsset: {
      assetRef: 'desktop-avatar://resource-1/previous.vrm',
      url: 'blob:previous-vrm',
      arrayBuffer: null,
    },
    loadedVrm: {
      status: 'ready',
      assetRef: 'desktop-avatar://resource-1/previous.vrm',
      vrm: {} as never,
      error: null,
    },
  });

  assert.deepEqual(state, {
    status: 'loading',
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
      assetRef: 'desktop-avatar://resource-1/previous.vrm',
      url: 'blob:previous-vrm',
      arrayBuffer: null,
    },
    loadedVrm: {
      status: 'error',
      assetRef: 'desktop-avatar://resource-1/previous.vrm',
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
      assetRef: 'desktop-avatar://resource-1/previous.vrm',
      url: 'blob:previous-vrm',
      arrayBuffer: null,
    },
    loadedVrm: {
      status: 'ready',
      assetRef: 'desktop-avatar://resource-1/previous.vrm',
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
    pointerHovered: true,
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

test('vrm diagnostic advances desktop resources into vrm-load once bytes are resolved', () => {
  const diagnostic = createChatAgentAvatarVrmDiagnostic({
    assetRef: 'desktop-avatar://resource-1/sample.vrm',
    assetLabel: 'Sample VRM',
    desktopAssetRef: {
      resourceId: 'resource-1',
      filename: 'sample.vrm',
    },
    assetUrl: null,
    assetResolved: true,
    networkAssetUrl: null,
    posterUrl: null,
    loadedStatus: 'loading',
    loadedError: null,
    status: 'loading',
    error: null,
    pointerHovered: false,
    resizePosture: 'tracked-host-size',
    viewportWidth: 320,
    viewportHeight: 480,
    hostRenderable: true,
    canvasEpoch: 1,
  });

  assert.equal(diagnostic.stage, 'vrm-load');
});

test('vrm viewport exposes debug overlay in minimal chrome when vrm is not ready', () => {
  const markup = renderToStaticMarkup(
    <ChatAgentAvatarVrmViewport
      chrome="minimal"
      input={{
        label: 'Companion',
        assetRef: 'https://cdn.nimi.test/avatars/airi.vrm',
        posterUrl: 'https://cdn.nimi.test/avatars/airi.png',
        idlePreset: null,
        expressionProfileRef: null,
        interactionPolicyRef: null,
        defaultVoiceReference: null,
        snapshot: {
          presentation: {
            backendKind: 'vrm',
            avatarAssetRef: 'https://cdn.nimi.test/avatars/airi.vrm',
          },
          interaction: {
            phase: 'idle',
            actionCue: 'Here with you',
          },
        },
      }}
    />,
  );

  assert.match(markup, /data-avatar-vrm-debug="true"/);
  assert.match(markup, /data-avatar-vrm-status="loading"/);
  assert.match(markup, /data-avatar-vrm-stage="vrm-load"/);
  assert.match(markup, /status: loading/);
  assert.match(markup, /stage: vrm-load/);
  assert.match(markup, /phase: idle/);
  assert.match(markup, /posture: idle-settled/);
  assert.match(markup, /speakingEnergy: 0\.00/);
  assert.match(markup, /object-contain object-center/);
  assert.doesNotMatch(markup, /object-cover object-top/);
  assert.doesNotMatch(markup, /inset-x-\[4%\] inset-y-\[3\.5%\] rounded-\[28px\]/);
  assert.match(markup, /source: network/);
  assert.match(markup, /resizePosture: tracked-host-size/);
  assert.match(markup, /canvasEpoch: 0/);
  assert.match(markup, /assetRef: https:\/\/cdn\.nimi\.test\/avatars\/airi\.vrm/);
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

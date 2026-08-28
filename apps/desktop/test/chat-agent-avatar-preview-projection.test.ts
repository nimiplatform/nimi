import assert from 'node:assert/strict';
import test from 'node:test';
import { requestDesktopAvatarPreviewProjection } from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-preview-projection.js';

const HANDLE = `agent_ref_${'A'.repeat(43)}`;

type PreviewTestHook = {
  invoke: (command: string, payload?: unknown) => Promise<unknown>;
  listen: () => () => void;
};

type PreviewTestGlobal = {
  window?: {
    __NIMI_HTML_BOOT_ID__?: string;
    __NIMI_ELECTRON_TEST__?: PreviewTestHook;
  };
  __NIMI_ELECTRON_TEST__?: PreviewTestHook;
};

test('Desktop committed preview bridge carries no raw Agent identity or Host material ref', async () => {
  const root = globalThis as unknown as PreviewTestGlobal;
  const previous = root.__NIMI_ELECTRON_TEST__;
  const previousWindow = root.window;
  const calls: unknown[] = [];
  const hook: PreviewTestHook = {
    async invoke(command: string, payload?: unknown) {
      calls.push({ command, payload });
      return {
        result: {
          state: 'unavailable', tier: 'avatar_preview_service',
          previewImageRef: null, visiblePixels: null, nonPlaceholder: false,
          reason: 'No supervised Avatar window.', warnings: [],
        },
      };
    },
    listen: () => () => undefined,
  };
  root.__NIMI_ELECTRON_TEST__ = hook;
  root.window = {
    ...(previousWindow ?? {}),
    __NIMI_HTML_BOOT_ID__: 'desktop-agent-center-preview-test',
    __NIMI_ELECTRON_TEST__: hook,
  };
  try {
    await assert.doesNotReject(requestDesktopAvatarPreviewProjection({
      agentHandle: HANDLE,
      avatarAssetRef: 'live2d_111111111111',
      backendKind: 'live2d',
      presentationRevision: '7',
    }));
  } finally {
    root.__NIMI_ELECTRON_TEST__ = previous;
    root.window = previousWindow;
  }
  assert.deepEqual(calls, [{
    command: 'desktop_avatar_preview_projection',
    payload: { payload: {
      agentHandle: HANDLE,
      avatarAssetRef: 'live2d_111111111111',
      backendKind: 'live2d',
      presentationRevision: '7',
    } },
  }]);
  assert.doesNotMatch(JSON.stringify(calls), /ownerUserId|runtimeSourceRef|localAgentRef|previewMaterialRef/u);
});

test('Desktop committed preview bridge rejects a stale noncanonical handle before Host invocation', async () => {
  await assert.rejects(requestDesktopAvatarPreviewProjection({
    agentHandle: 'local-agent:raw',
    avatarAssetRef: 'live2d_111111111111',
    backendKind: 'live2d',
    presentationRevision: '7',
  }), /canonical opaque agentHandle/u);
});

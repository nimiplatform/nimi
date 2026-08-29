import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopAgentCenterHostMechanics } from '../src/shell/renderer/features/chat/chat-agent-center-host-mechanics.js';

const CONVERSATION_ANCHOR_ID = 'agent_anchor_preview_current';

test('Desktop Agent Center preview carries only the canonical Conversation anchor and committed presentation facts', async () => {
  const previewCalls: unknown[] = [];
  const mechanics = createDesktopAgentCenterHostMechanics({
    conversationAnchorId: CONVERSATION_ANCHOR_ID,
    shell: {
      async pickAvatarAssetMaterial() { return null; },
      async pickBackgroundAssetMaterial() { return null; },
    },
    avatarHandoff: {
      available: () => true,
      async list() { return []; },
      async preview(input) {
        previewCalls.push(input);
        return {
          state: 'ready', tier: 'avatar_preview_service',
          previewImageRef: '/__nimi/avatar-preview/current.png',
          visiblePixels: 42, nonPlaceholder: true, warnings: [],
        };
      },
      async launch() { return { opened: true }; },
      async close() { return { opened: false }; },
    },
  });

  const preview = mechanics.resolveCommittedPreview?.({
    backendKind: 'vrm',
    avatarAssetRef: 'asset://avatar/current',
    presentationRevision: '7',
  });
  assert.ok(preview);
  await assert.doesNotReject(preview);
  assert.deepEqual(previewCalls, [{
    conversationAnchorId: CONVERSATION_ANCHOR_ID,
    backendKind: 'vrm',
    avatarAssetRef: 'asset://avatar/current',
    presentationRevision: '7',
  }]);
  assert.doesNotMatch(JSON.stringify(previewCalls), /ownerUserId|runtimeSourceRef|localAgentRef|previewMaterialRef/u);
});

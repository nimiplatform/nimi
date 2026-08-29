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
      async pickResourcePackMaterial() { return null; },
    },
    avatarHandoff: {
      available: () => true,
      async preview(input) {
        previewCalls.push(input);
        return {
          state: 'ready', tier: 'avatar_preview_service',
          backendKind: input.backendKind,
          avatarAssetRef: input.avatarAssetRef,
          previewMaterialRef: 'agent-center-preview-material:current',
          previewImageRef: '/__nimi/avatar-preview/current.png',
          warnings: [],
        };
      },
      async launch() { return { opened: true }; },
    },
  });
  assert.equal(mechanics.selectResourcePack, undefined);

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

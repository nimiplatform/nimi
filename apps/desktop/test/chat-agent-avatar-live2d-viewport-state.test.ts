import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listDesktopAgentAvatarResources,
  readDesktopAgentAvatarResourceAsset,
  readDesktopAgentAvatarResourceRelativeAsset,
} from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-store.js';
import {
  loadChatAgentAvatarLive2dModelSource,
  parseChatAgentAvatarLive2dMocVersion,
  parseChatAgentAvatarLive2dModelSettings,
  resolvePreferredLive2dIdleMotionGroup,
  resolvePreferredLive2dSpeechMotionGroup,
} from '../src/shell/renderer/features/chat/chat-agent-avatar-live2d-viewport-state.js';

function encodeUtf8Base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function encodeMoc3Base64(version: number): string {
  const bytes = Buffer.alloc(16);
  bytes.write('MOC3', 0, 'ascii');
  bytes.writeUInt32LE(version, 4);
  return bytes.toString('base64');
}

test('live2d viewport state parses model3 motion groups from desktop asset payload', () => {
  const settings = parseChatAgentAvatarLive2dModelSettings({
    mimeType: 'application/json',
    base64: encodeUtf8Base64(JSON.stringify({
      FileReferences: {
        Motions: {
          Idle: [{ File: 'motions/idle.motion3.json' }],
          TapTalk: [{ File: 'motions/talk.motion3.json' }],
        },
      },
    })),
  });

  assert.deepEqual(settings.motionGroups, ['Idle', 'TapTalk']);
  assert.equal(resolvePreferredLive2dIdleMotionGroup(settings.motionGroups), 'Idle');
  assert.equal(resolvePreferredLive2dSpeechMotionGroup(settings.motionGroups), 'TapTalk');
});

test('live2d viewport state parses moc version from moc3 payload header', () => {
  const version = parseChatAgentAvatarLive2dMocVersion({
    mimeType: 'application/octet-stream',
    base64: encodeMoc3Base64(6),
  });

  assert.equal(version, 6);
});

test('live2d viewport state fails closed when stale desktop-avatar source loading hits the decommissioned bridge', async () => {
  await assert.rejects(
    () => loadChatAgentAvatarLive2dModelSource(
      'desktop-avatar://resource-live2d/airi.model3.json',
      {
        listResources: listDesktopAgentAvatarResources,
        readAsset: readDesktopAgentAvatarResourceAsset,
        readRelativeAsset: readDesktopAgentAvatarResourceRelativeAsset,
      },
    ),
    /decommissioned in Wave 4 Exec Pack 4/i,
  );
});

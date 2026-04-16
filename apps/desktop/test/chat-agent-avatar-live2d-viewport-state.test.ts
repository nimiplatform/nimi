import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadChatAgentAvatarLive2dModelSource,
  parseChatAgentAvatarLive2dModelSettings,
  resolvePreferredLive2dIdleMotionGroup,
  resolvePreferredLive2dSpeechMotionGroup,
} from '../src/shell/renderer/features/chat/chat-agent-avatar-live2d-viewport-state.js';

function encodeUtf8Base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
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

test('live2d viewport state resolves desktop-local model source through admitted avatar bridge dependencies', async () => {
  const source = await loadChatAgentAvatarLive2dModelSource(
    'desktop-avatar://resource-live2d/airi.model3.json',
    {
      listResources: async () => ([
        {
          resourceId: 'resource-live2d',
          kind: 'live2d',
          displayName: 'Airi Live2D',
          sourceFilename: 'airi.model3.json',
          storedPath: '/tmp/airi',
          fileUrl: 'file:///tmp/airi/airi.model3.json',
          posterPath: null,
          importedAtMs: 10,
          updatedAtMs: 20,
          status: 'ready',
        },
      ]),
      readAsset: async () => ({
        mimeType: 'application/json',
        base64: encodeUtf8Base64(JSON.stringify({
          FileReferences: {
            Motions: {
              IdleMain: [{ File: 'motions/idle.motion3.json' }],
              VoiceLine: [{ File: 'motions/voice.motion3.json' }],
            },
          },
        })),
      }),
    },
  );

  assert.equal(source.resourceId, 'resource-live2d');
  assert.equal(source.fileUrl, 'file:///tmp/airi/airi.model3.json');
  assert.match(source.modelUrl, /^blob:/);
  assert.equal(source.assetLabel, 'Airi Live2D');
  assert.deepEqual(source.motionGroups, ['IdleMain', 'VoiceLine']);
  assert.equal(source.idleMotionGroup, 'IdleMain');
  assert.equal(source.speechMotionGroup, 'VoiceLine');
  assert.deepEqual(source.resolvedAssetUrls, [
    'file:///tmp/airi/motions/idle.motion3.json',
    'file:///tmp/airi/motions/voice.motion3.json',
  ]);
  source.cleanup?.();
});

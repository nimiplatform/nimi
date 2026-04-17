import assert from 'node:assert/strict';
import test from 'node:test';

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
      readRelativeAsset: async ({ relativePath }) => ({
        mimeType: relativePath.endsWith('.json') ? 'application/json' : 'application/octet-stream',
        base64: relativePath.endsWith('.moc3')
          ? encodeMoc3Base64(5)
          : encodeUtf8Base64(relativePath),
      }),
    },
  );

  assert.equal(source.resourceId, 'resource-live2d');
  assert.equal(source.fileUrl, 'file:///tmp/airi/airi.model3.json');
  assert.equal(source.modelUrl, 'file:///tmp/airi/airi.model3.json');
  assert.equal(typeof source.runtimeSource, 'object');
  assert.equal((source.runtimeSource as { url?: string }).url, 'file:///tmp/airi/airi.model3.json');
  assert.equal(source.assetLabel, 'Airi Live2D');
  assert.equal(source.mocVersion, null);
  assert.deepEqual(source.motionGroups, ['IdleMain', 'VoiceLine']);
  assert.equal(source.idleMotionGroup, 'IdleMain');
  assert.equal(source.speechMotionGroup, 'VoiceLine');
  assert.deepEqual(source.resolvedAssetUrls, [
    'file:///tmp/airi/motions/idle.motion3.json',
    'file:///tmp/airi/motions/voice.motion3.json',
  ]);
  assert.match(
    ((source.runtimeSource as { FileReferences?: { Motions?: { IdleMain?: Array<{ File?: string }> } } })
      .FileReferences?.Motions?.IdleMain?.[0]?.File || ''),
    /^live2d-memory:\/\//,
  );
  assert.equal(Object.keys(source.runtimeAssetPayloads || {}).length, 2);
  source.cleanup?.();
});

test('live2d viewport state rewrites desktop-local runtime assets to fetchable in-memory urls', async () => {
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
            Moc: 'airi.moc3',
            Textures: ['textures/texture_00.png'],
            Physics: 'airi.physics3.json',
            Pose: 'airi.pose3.json',
            Motions: {
              IdleMain: [{ File: 'motions/idle.motion3.json' }],
            },
          },
        })),
      }),
      readRelativeAsset: async ({ relativePath }) => ({
        mimeType: relativePath.endsWith('.png')
          ? 'image/png'
          : relativePath.endsWith('.moc3')
            ? 'application/octet-stream'
            : 'application/json',
        base64: relativePath.endsWith('.moc3')
          ? encodeMoc3Base64(6)
          : encodeUtf8Base64(relativePath),
      }),
    },
  );

  const fileReferences = (source.runtimeSource as {
    FileReferences?: {
      Moc?: string;
      Textures?: string[];
      Physics?: string;
      Pose?: string;
      Motions?: Record<string, Array<{ File?: string }>>;
    };
  }).FileReferences;
  assert.match(fileReferences?.Moc || '', /^live2d-memory:\/\//);
  assert.match(fileReferences?.Textures?.[0] || '', /^live2d-memory:\/\//);
  assert.match(fileReferences?.Physics || '', /^live2d-memory:\/\//);
  assert.match(fileReferences?.Pose || '', /^live2d-memory:\/\//);
  assert.match(fileReferences?.Motions?.IdleMain?.[0]?.File || '', /^live2d-memory:\/\//);
  assert.equal(Object.keys(source.runtimeAssetPayloads || {}).length, 5);
});

test('live2d viewport state keeps Cubism 5 moc payloads for the official renderer path', async () => {
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
            Moc: 'airi.moc3',
            Motions: {},
          },
        })),
      }),
      readRelativeAsset: async ({ relativePath }) => ({
        mimeType: relativePath.endsWith('.moc3') ? 'application/octet-stream' : 'application/json',
        base64: relativePath.endsWith('.moc3')
          ? encodeMoc3Base64(6)
          : encodeUtf8Base64(relativePath),
      }),
    },
  );

  assert.equal(source.mocVersion, 6);
  source.cleanup?.();
});

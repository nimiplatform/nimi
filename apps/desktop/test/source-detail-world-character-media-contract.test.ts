import assert from 'node:assert/strict';
import test from 'node:test';

import { toSourceDetailData } from '../src/shell/renderer/features/source-detail/source-detail-model.js';

test('source detail preserves forged world character media and Mimo voice metadata', () => {
  const detail = toSourceDetailData({
    id: 'char-song-scholar',
    displayName: 'Song Scholar',
    avatarUrl: '/tmp/nimi-forge/character/avatar.png',
    profileCoverUrl: '/tmp/nimi-forge/character/profile-cover.png',
    referenceImageUrl: '/tmp/nimi-forge/character/reference.png',
    bio: 'A source-bound world character.',
    createdAt: '2026-06-19T00:00:00.000Z',
    worldId: 'world-song',
    sourceKind: 'worldCharacter',
    sourceId: 'char-song-scholar',
    sourceContentHash: 'a'.repeat(64),
    source: {
      authoring: {
        extensions: {
          worldStudioSettings: {
            voice: {
              voiceId: 'voice-char-song-scholar-voice-design-1',
              sampleUri: '/tmp/nimi-forge/character/voice-sample.wav',
              provider: 'mimo',
              workflow: 'voice_design',
              model: 'mimo-v2.5-tts-voicedesign',
              prompt: 'A measured Song dynasty scholar voice.',
              transcript: '天地有常，人事有源。',
              previewText: '天地有常，人事有源。',
            },
          },
        },
      },
    },
  }, 'source_connectable');

  assert.equal(detail.profileCoverUrl, '/tmp/nimi-forge/character/profile-cover.png');
  assert.equal(detail.referenceImageUrl, '/tmp/nimi-forge/character/reference.png');
  assert.deepEqual(detail.voiceDesign, {
    voiceId: 'voice-char-song-scholar-voice-design-1',
    sampleUri: '/tmp/nimi-forge/character/voice-sample.wav',
    provider: 'mimo',
    workflow: 'voice_design',
    model: 'mimo-v2.5-tts-voicedesign',
    prompt: 'A measured Song dynasty scholar voice.',
    transcript: '天地有常，人事有源。',
    previewText: '天地有常，人事有源。',
  });
});

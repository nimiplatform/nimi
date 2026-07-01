import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { initI18n } from '../src/shell/renderer/i18n';
import { toSourceDetailData } from '../src/shell/renderer/features/source-detail/source-detail-model.js';
import { SourceDetailView } from '../src/shell/renderer/features/source-detail/source-detail-view.js';

(globalThis as { React?: typeof React }).React = React;

test.before(async () => {
  await initI18n();
});

function sourceDetailRaw() {
  return {
    id: 'char-song-scholar',
    displayName: 'Song Scholar',
    avatarUrl: '/tmp/nimi-forge/character/avatar.png',
    profileCoverUrl: '/tmp/nimi-forge/character/profile-cover.png',
    referenceImageUrl: '/tmp/nimi-forge/character/reference.png',
    media: {
      avatarUrl: 'https://cdn.example.test/character/avatar.png',
      profileCoverUrl: 'https://cdn.example.test/character/profile-cover.png',
      referenceImageUrl: 'https://cdn.example.test/character/reference.png',
      voiceSampleUrl: 'https://cdn.example.test/character/voice-sample.wav',
      assets: {
        avatar: {
          id: 'character-avatar-resource',
          kind: 'avatar',
          url: 'https://cdn.example.test/character/avatar.png',
          provider: 'CF_IMAGE',
          mimeType: 'image/png',
          width: 512,
          height: 512,
          durationSec: null,
          sha256: 'sha256-avatar',
        },
        profileCover: {
          id: 'character-profile-cover-resource',
          kind: 'profileCover',
          url: 'https://cdn.example.test/character/profile-cover.png',
          provider: 'CF_IMAGE',
          mimeType: 'image/png',
          width: 1600,
          height: 900,
          durationSec: null,
          sha256: 'sha256-cover',
        },
        referenceImage: {
          id: 'character-reference-resource',
          kind: 'referenceImage',
          url: 'https://cdn.example.test/character/reference.png',
          provider: 'CF_IMAGE',
          mimeType: 'image/png',
          width: 1024,
          height: 1536,
          durationSec: null,
          sha256: 'sha256-reference',
        },
        voiceSample: {
          id: 'character-voice-resource',
          kind: 'voiceSample',
          url: 'https://cdn.example.test/character/voice-sample.wav',
          provider: 'S3_OBJECT',
          mimeType: 'audio/wav',
          width: null,
          height: null,
          durationSec: 8.42,
          sha256: 'sha256-voice',
        },
      },
    },
    bio: 'A source-bound world character.',
    createdAt: '2026-06-19T00:00:00.000Z',
    worldId: 'world-song',
    sourceKind: 'worldCharacter',
    sourceId: 'char-song-scholar',
    sourceContentHash: 'a'.repeat(64),
    entity: {
      id: 'entity-song-scholar',
      kind: 'person',
      name: 'Song Scholar Entity',
      summary: 'Canonical semantic person bound to the source character.',
      contentHash: 'e'.repeat(64),
      tags: ['scholar', 'song-dynasty'],
      facts: [
        {
          factId: 'fact-1',
          key: 'office',
          value: 'Hanlin scholar',
        },
      ],
    },
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
  };
}

test('source detail consumes public world character media and voice resources', () => {
  const detail = toSourceDetailData({
    ...sourceDetailRaw(),
  }, 'source_materializable');

  assert.equal(detail.avatarUrl, 'https://cdn.example.test/character/avatar.png');
  assert.equal(detail.profileCoverUrl, 'https://cdn.example.test/character/profile-cover.png');
  assert.equal(detail.referenceImageUrl, 'https://cdn.example.test/character/reference.png');
  assert.deepEqual(detail.voiceSample, {
    id: 'character-voice-resource',
    url: 'https://cdn.example.test/character/voice-sample.wav',
    provider: 'S3_OBJECT',
    mimeType: 'audio/wav',
    durationSec: 8.42,
    sha256: 'sha256-voice',
    transcript: null,
    previewText: null,
  });
  assert.equal(detail.voiceDesign, null);
  assert.deepEqual(detail.entity, {
    id: 'entity-song-scholar',
    kind: 'person',
    name: 'Song Scholar Entity',
    summary: 'Canonical semantic person bound to the source character.',
    contentHash: 'e'.repeat(64),
    tags: ['scholar', 'song-dynasty'],
    facts: [
      {
        factId: 'fact-1',
        key: 'office',
        value: 'Hanlin scholar',
      },
    ],
  });
});

test('world character detail renders reference image and voice sample controls', () => {
  const detail = toSourceDetailData(sourceDetailRaw(), 'source_materializable');
  const markup = renderToStaticMarkup(
    React.createElement(SourceDetailView, {
      source: detail,
      loading: false,
      error: false,
      stats: null,
      worldScore: 75,
      onBack: () => undefined,
      onOpenWorld: () => undefined,
      onPrimaryAction: () => undefined,
      onSendGift: () => undefined,
    }),
  );

  assert.match(markup, /data-testid="world-character-reference-image"/);
  assert.match(markup, /data-testid="world-character-voice-sample-audio"/);
  assert.match(markup, /https:\/\/cdn\.example\.test\/character\/reference\.png/);
  assert.match(markup, /https:\/\/cdn\.example\.test\/character\/voice-sample\.wav/);
  assert.match(markup, /data-testid="world-character-reference-image"[^>]*aspect-\[2\/3\]/);
  assert.match(markup, /src="https:\/\/cdn\.example\.test\/character\/reference\.png" alt="" class="[^"]*object-contain/);
  assert.doesNotMatch(markup, /src="https:\/\/cdn\.example\.test\/character\/reference\.png" alt="" class="[^"]*object-cover/);
  assert.doesNotMatch(markup, /bg-\[#f3eee3\]/);
  assert.doesNotMatch(markup, /\/tmp\/nimi-forge/);
});

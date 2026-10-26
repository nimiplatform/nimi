import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';

import { initI18n } from '../src/shell/renderer/i18n';
import { toSourceDetailData } from '../src/shell/renderer/features/source-detail/source-detail-model.js';
import { SourceDetailView } from '../src/shell/renderer/features/source-detail/source-detail-view.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';

function renderToStaticMarkup(element: React.ReactNode): string {
  const bindings = {
    app: { projection: { resourceBaseUrl: () => '' } },
  } as DesktopCanonicalRendererBindings;
  return renderMarkup(
    React.createElement(DesktopRendererBindingProvider, { bindings }, element),
  );
}

(globalThis as { React?: typeof React }).React = React;

type SourceDetailLocaleProbe = {
  worldCharacter?: {
    mediaEyebrow?: unknown;
  };
};

test.before(async () => {
  await initI18n();
});

function readSourceDetailZhLocale(): SourceDetailLocaleProbe {
  return JSON.parse(readFileSync(new URL('../src/shell/renderer/locales/zh/22-SourceDetail.json', import.meta.url), 'utf8')) as SourceDetailLocaleProbe;
}

function sourceDetailRaw() {
  return {
    id: 'char-song-scholar',
    displayName: 'Song Scholar',
    avatarUrl: '/tmp/nimi-forge/character/avatar.png',
    profileCoverUrl: '/tmp/nimi-forge/character/profile-cover.png',
    referenceImageUrl: '/tmp/nimi-forge/character/reference.png',
    media: {external: { avatarUrl: 'https://cdn.example.test/character/avatar.png', profileCoverUrl: 'https://cdn.example.test/character/profile-cover.png', referenceImageUrl: 'https://cdn.example.test/character/reference.png', voiceSampleUrl: 'https://cdn.example.test/character/voice-sample.wav' },
      assets: {
        avatar: {
          id: 'character-avatar-resource',
          kind: 'avatar',
          externalUrl: 'https://cdn.example.test/character/avatar.png',
          provider: 'EXTERNAL_URL',
          mimeType: 'image/png',
          width: 512,
          height: 512,
          durationSec: null,
          sha256: 'sha256-avatar',
        },
        profileCover: {
          id: 'character-profile-cover-resource',
          kind: 'profileCover',
          externalUrl: 'https://cdn.example.test/character/profile-cover.png',
          provider: 'EXTERNAL_URL',
          mimeType: 'image/png',
          width: 1600,
          height: 900,
          durationSec: null,
          sha256: 'sha256-cover',
        },
        referenceImage: {
          id: 'character-reference-resource',
          kind: 'referenceImage',
          externalUrl: 'https://cdn.example.test/character/reference.png',
          provider: 'EXTERNAL_URL',
          mimeType: 'image/png',
          width: 1024,
          height: 1536,
          durationSec: null,
          sha256: 'sha256-reference',
        },
        voiceSample: {
          id: 'character-voice-resource',
          kind: 'voiceSample',
          externalUrl: 'https://cdn.example.test/character/voice-sample.wav',
          provider: 'EXTERNAL_URL',
          mimeType: 'audio/wav',
          width: null,
          height: null,
          durationSec: 8.42,
              },
      },
    },
    bio: 'A source-bound world character.',
    createdAt: '2026-06-19T00:00:00.000Z',
    worldId: 'world-song',
    sourceKind: 'worldCharacter',
    sourceId: 'char-song-scholar',
    sourceHash: 'a'.repeat(64),
    sourceRef: {
      kind: 'worldCharacter',
      id: 'char-song-scholar',
      worldId: 'world-song',
      worldEntityRef: { kind: 'worldEntity', worldId: 'world-song', entityId: 'entity-song-scholar' },
      sourceHash: 'a'.repeat(64),
    },
    viewerRelation: {
      state: 'connectable',
      connectionId: null,
      runtimeSourceRef: null,
    },
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
    characterProfile: {
      role: 'Scholar',
      archetype: 'Archivist',
      traits: ['measured'],
      knowledgeTopics: ['archives'],
      knowledgeConstraints: [],
      interactionModes: ['research'],
      milestones: [],
      relationshipNotes: [],
      conversationAnchors: ['archives'],
      interaction: {
        tone: 'A measured Song dynasty scholar voice.',
        cadence: 'Deliberate cadence with quiet pauses.',
        scenario: null,
        greeting: 'The archives are quiet; ask, and I will open them.',
      },
    },
    source: {
      interactionProfile: {
        tone: 'A measured Song dynasty scholar voice.',
        cadence: 'Deliberate cadence with quiet pauses.',
        greeting: 'The archives are quiet; ask, and I will open them.',
      },
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
  }, 'source_materialization_available');

  assert.equal(detail.avatarUrl, 'https://cdn.example.test/character/avatar.png');
  assert.equal(detail.profileCoverUrl, 'https://cdn.example.test/character/profile-cover.png');
  assert.equal(detail.referenceImageUrl, 'https://cdn.example.test/character/reference.png');
  assert.deepEqual(detail.voiceSample, {
    id: 'character-voice-resource',
    previewUrl: 'https://cdn.example.test/character/voice-sample.wav',
    originalUrl: null,
    durationSec: 8.42,
    transcript: null,
    previewText: null,
  });
  assert.deepEqual(detail.characterProfile.interaction, {
    tone: 'A measured Song dynasty scholar voice.',
    cadence: 'Deliberate cadence with quiet pauses.',
    scenario: null,
    greeting: 'The archives are quiet; ask, and I will open them.',
  });
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

test('world character detail renders the hero voice preview and sample dialogue from public media', () => {
  const detail = toSourceDetailData(sourceDetailRaw(), 'source_materialization_available');
  const markup = renderToStaticMarkup(
    React.createElement(SourceDetailView, {
      source: detail,
      loading: false,
      error: false,
      stats: null,
      onBack: () => undefined,
      onOpenWorld: () => undefined,
      onPrimaryAction: () => undefined,
    }),
  );

  // The hero carries a compact voice preview row: round play button, label,
  // and the authored duration; the audio element stays hidden.
  assert.match(markup, /data-testid="world-character-hero-voice"/);
  assert.match(markup, /data-testid="world-character-voice-play-button"[^>]*aria-label="Play voice"/);
  assert.match(markup, /data-testid="world-character-voice-sample-audio"[^>]*src="https:\/\/cdn\.example\.test\/character\/voice-sample\.wav"/);
  assert.match(markup, /Voice preview/);
  assert.match(markup, /· 8s/);
  // The authored greeting renders once, as the character bubble of the sample
  // dialogue. Voice direction metadata stays in the typed profile, outside
  // the reading layout.
  assert.match(markup, /data-testid="world-character-dialogue-section"/);
  assert.match(markup, /data-testid="world-character-opening-line"[\s\S]*The archives are quiet; ask, and I will open them\./);
  assert.equal(markup.match(/The archives are quiet; ask, and I will open them\./gu)?.length, 1);
  assert.equal(detail.characterProfile.interaction?.tone, 'A measured Song dynasty scholar voice.');
  assert.equal(detail.characterProfile.interaction?.cadence, 'Deliberate cadence with quiet pauses.');
  assert.doesNotMatch(markup, /A measured Song dynasty scholar voice\.|Deliberate cadence with quiet pauses\./);
  // The reference portrait card is gone from the presence layout, and neither
  // internal media labels nor local file paths leak into the page.
  assert.doesNotMatch(markup, /data-testid="world-character-reference-image"/);
  assert.doesNotMatch(markup, /data-testid="world-character-media-section"/);
  assert.doesNotMatch(markup, /data-testid="world-character-speech-profile-trigger"/);
  assert.doesNotMatch(markup, /reference\.png/);
  assert.doesNotMatch(markup, />i<\/button>/);
  assert.doesNotMatch(markup, /lucide-info/);
  assert.doesNotMatch(markup, /data-testid="world-character-voice-sample"/);
  assert.doesNotMatch(markup, /Voice sample|audio\/wav/);
  assert.doesNotMatch(markup, /\/tmp\/nimi-forge/);
});

test('world character zh media locale names presence instead of internal media assets', () => {
  const locale = readSourceDetailZhLocale();

  assert.equal(locale.worldCharacter?.mediaEyebrow, '形象');
});

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
    url: 'https://cdn.example.test/character/voice-sample.wav',
    provider: 'S3_OBJECT',
    mimeType: 'audio/wav',
    durationSec: 8.42,
    sha256: 'sha256-voice',
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

test('world character detail renders reference image and voice sample controls', () => {
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

  assert.match(markup, /data-testid="world-character-reference-image"/);
  assert.match(markup, /data-testid="world-character-opening-line"/);
  assert.match(markup, /data-testid="world-character-speech-profile-trigger"/);
  assert.match(markup, /data-testid="world-character-voice-sample-audio"/);
  assert.doesNotMatch(markup, />Look and voice</);
  assert.doesNotMatch(markup, />Presence<\/p>/);
  assert.doesNotMatch(markup, /Character media/);
  assert.match(markup, /data-testid="world-character-media-section"[\s\S]*data-testid="world-character-opening-line"[\s\S]*data-testid="world-character-voice-sample-audio"/);
  assert.match(markup, /data-testid="world-character-media-frame"[\s\S]*data-testid="world-character-reference-image"/);
  assert.match(markup, /data-testid="world-character-reference-image"[\s\S]*data-testid="world-character-opening-line"[\s\S]*data-testid="world-character-voice-play-button"[\s\S]*data-testid="world-character-voice-sample-audio"/);
  assert.match(markup, /data-testid="world-character-reference-image"[^>]*class="[^"]*relative/);
  assert.match(markup, /bg-gradient-to-t from-black\/80/);
  assert.match(markup, /data-testid="world-character-voice-play-button"[^>]*aria-label="Play voice"/);
  assert.match(markup, /data-testid="world-character-opening-line"[\s\S]*data-testid="world-character-speech-profile-trigger"[\s\S]*>i<\/button>[\s\S]*The archives are quiet; ask, and I will open them\./);
  assert.match(markup, /The archives are quiet; ask, and I will open them\./);
  assert.match(markup, /A measured Song dynasty scholar voice\./);
  assert.match(markup, /Deliberate cadence with quiet pauses\./);
  const openingLineTag = markup.match(/<div data-testid="world-character-opening-line"[^>]*>/)?.[0] ?? '';
  const speechProfileTriggerTag = markup.match(/<button[^>]*data-testid="world-character-speech-profile-trigger"[^>]*>/)?.[0] ?? '';
  assert.doesNotMatch(openingLineTag, /border|rounded|bg-\[/);
  assert.match(speechProfileTriggerTag, /aria-label="Tone: A measured Song dynasty scholar voice\. · Cadence: Deliberate cadence with quiet pauses\."/);
  assert.match(speechProfileTriggerTag, /h-\[14px\]/);
  assert.match(speechProfileTriggerTag, /w-\[14px\]/);
  assert.match(speechProfileTriggerTag, /text-\[8px\]/);
  assert.doesNotMatch(speechProfileTriggerTag, /\bh-5\b|\bw-5\b|text-\[9px\]|text-\[12px\]/);
  assert.match(speechProfileTriggerTag, /rounded-full/);
  assert.match(speechProfileTriggerTag, /border/);
  assert.match(speechProfileTriggerTag, /bg-\[var\(--nimi-surface-card\)\]/);
  assert.doesNotMatch(speechProfileTriggerTag, /\bitalic\b/);
  assert.doesNotMatch(speechProfileTriggerTag, /\stitle=/);
  assert.doesNotMatch(markup, />Greeting<\/p>/);
  assert.equal(markup.match(/The archives are quiet; ask, and I will open them\./gu)?.length, 1);
  assert.doesNotMatch(markup, /lucide-info/);
  assert.doesNotMatch(markup, /data-testid="world-character-voice-sample"/);
  assert.doesNotMatch(markup, /Voice sample|audio\/wav/);
  assert.match(markup, /https:\/\/cdn\.example\.test\/character\/reference\.png/);
  assert.match(markup, /https:\/\/cdn\.example\.test\/character\/voice-sample\.wav/);
  assert.match(markup, /data-testid="world-character-reference-image"[^>]*aspect-\[2\/3\]/);
  assert.match(markup, /src="https:\/\/cdn\.example\.test\/character\/reference\.png" alt="" class="[^"]*object-contain/);
  assert.doesNotMatch(markup, /src="https:\/\/cdn\.example\.test\/character\/reference\.png" alt="" class="[^"]*object-cover/);
  assert.doesNotMatch(markup, /bg-\[#f3eee3\]/);
  assert.doesNotMatch(markup, /\/tmp\/nimi-forge/);
});

test('world character zh media locale names presence instead of internal media assets', () => {
  const locale = readSourceDetailZhLocale();

  assert.equal(locale.worldCharacter?.mediaEyebrow, '形象');
});

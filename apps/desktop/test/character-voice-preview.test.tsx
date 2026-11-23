import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import {
  CharacterVoicePreviewButton,
  stopCharacterVoicePreview,
  toggleCharacterVoicePreview,
} from '../src/shell/renderer/features/explore/character-voice-preview.js';
import {
  interleaveCharactersByWorld,
  readCharacterCatalog,
  type CharacterCatalogItem,
} from '../src/shell/renderer/features/explore/character-catalog-data.js';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';

test('singleton voice preview switches cleanly between characters without overlapping playback', () => {
  const events: string[] = [];
  class FakeAudio {
    src = '';
    preload = 'none';
    currentTime = 0;
    paused = true;
    ended = false;
    private listeners = new Map<string, Set<() => void>>();
    addEventListener(type: string, handler: () => void) {
      const set = this.listeners.get(type) ?? new Set();
      set.add(handler);
      this.listeners.set(type, set);
    }
    async play() {
      this.paused = false;
      this.ended = false;
      events.push(`play:${this.src}`);
    }
    pause() {
      if (!this.paused) {
        this.paused = true;
        events.push(`pause:${this.src}`);
        this.listeners.get('pause')?.forEach((fn) => fn());
      }
    }
  }
  const previousAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  Object.defineProperty(globalThis, 'Audio', { configurable: true, writable: true, value: FakeAudio });
  try {
    toggleCharacterVoicePreview('https://assets-preview.nimi.ai/audio/a.mp3');
    toggleCharacterVoicePreview('https://assets-preview.nimi.ai/audio/b.mp3');
    toggleCharacterVoicePreview('https://assets-preview.nimi.ai/audio/b.mp3');
    stopCharacterVoicePreview();
    assert.deepEqual(events, [
      'play:https://assets-preview.nimi.ai/audio/a.mp3',
      'pause:https://assets-preview.nimi.ai/audio/a.mp3',
      'play:https://assets-preview.nimi.ai/audio/b.mp3',
      'pause:https://assets-preview.nimi.ai/audio/b.mp3',
    ]);
  } finally {
    stopCharacterVoicePreview();
    if (previousAudio) Object.defineProperty(globalThis, 'Audio', previousAudio);
    else Reflect.deleteProperty(globalThis, 'Audio');
  }
});

test('readCharacterCatalog forwards worldId filter and projects role and voiceSampleUrl', async () => {
  const queries: unknown[] = [];
  const sdk = {
    realm: () => ({
      worldPublic: {
        worldPublicControllerListCharacterCatalog: async (input: { query: unknown }) => {
          queries.push(input.query);
          return {
            totalCount: 1,
            hasMore: false,
            nextCursor: null,
            items: [{
              id: 'char-1',
              sourceRef: {
                kind: 'worldCharacter',
                id: 'char-1',
                worldId: 'tianting-outsourcing',
                worldEntityRef: { kind: 'worldEntity', worldId: 'tianting-outsourcing', entityId: 'ent-1' },
                sourceHash: 'a'.repeat(64),
              },
              displayName: '白骨绵绵',
              summary: '天庭碰瓷界顶流。',
              role: '戏精法务维权客',
              worldName: '南天门外包部：西游后五百年',
              avatarMedia: null,
              avatarUrl: 'https://assets-preview.nimi.ai/avatar.webp',
              voiceSampleUrl: 'https://assets-preview.nimi.ai/audio/voice.mp3',
              relation: { state: 'connectable' },
            }],
          };
        },
      },
    }),
  } as unknown as DesktopRendererSdkPort;

  const page = await readCharacterCatalog(sdk, '法务', undefined, 'tianting-outsourcing');
  assert.deepEqual(queries, [{ q: '法务', worldId: 'tianting-outsourcing', limit: 20 }]);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]!.role, '戏精法务维权客');
  assert.equal(page.items[0]!.voiceSampleUrl, 'https://assets-preview.nimi.ai/audio/voice.mp3');

  await readCharacterCatalog(sdk, '', undefined, undefined, { topicId: 'comedy', limit: 100 });
  assert.deepEqual(queries[1], { topicId: 'comedy', limit: 100 });
});

test('interleaveCharactersByWorld distributes characters across worlds round-robin while preserving per-world order', () => {
  const makeItem = (worldId: string, id: string): CharacterCatalogItem => ({
    sourceRef: {
      kind: 'worldCharacter',
      id,
      worldId,
      worldEntityRef: { kind: 'worldEntity', worldId, entityId: `ent-${id}` },
      sourceHash: 'a'.repeat(64),
    },
    name: id,
    summary: '',
    role: null,
    avatarUrl: null,
    avatarMedia: null,
    voiceSampleUrl: null,
    worldName: worldId,
  });
  const input = [
    makeItem('w1', 'w1-a'),
    makeItem('w1', 'w1-b'),
    makeItem('w1', 'w1-c'),
    makeItem('w2', 'w2-a'),
    makeItem('w2', 'w2-b'),
    makeItem('w3', 'w3-a'),
  ];
  assert.deepEqual(
    interleaveCharactersByWorld(input).map((item) => item.name),
    ['w1-a', 'w2-a', 'w3-a', 'w1-b', 'w2-b', 'w1-c'],
  );
});

test('CharacterVoicePreviewButton supports icon-only mode while preserving accessible name and default labeled surface mode', () => {
  const iconOnlyHtml = renderToStaticMarkup(
    <CharacterVoicePreviewButton src="https://assets-preview.nimi.ai/audio/a.mp3" characterName="白九谣" iconOnly />,
  );
  const iconOnlyButton = new JSDOM(iconOnlyHtml).window.document.querySelector('[data-testid="character-voice-preview-button"]');
  assert.ok(iconOnlyButton, 'renders icon-only voice button');
  assert.equal(iconOnlyButton.textContent?.trim(), '', 'icon-only mode omits visible text');
  assert.ok(iconOnlyButton.querySelector('svg'), 'icon-only mode keeps play icon');
  assert.ok(iconOnlyButton.getAttribute('aria-label')?.includes('白九谣'), 'icon-only mode preserves aria-label');
  assert.equal(iconOnlyButton.getAttribute('title'), iconOnlyButton.getAttribute('aria-label'));

  const labeledHtml = renderToStaticMarkup(
    <CharacterVoicePreviewButton src="https://assets-preview.nimi.ai/audio/a.mp3" characterName="白九谣" variant="surface" />,
  );
  const labeledButton = new JSDOM(labeledHtml).window.document.querySelector('[data-testid="character-voice-preview-button"]');
  assert.ok(labeledButton, 'renders labeled voice button');
  assert.ok((labeledButton.textContent?.trim().length ?? 0) > 0, 'default surface mode keeps visible label text');
  assert.ok(labeledButton.querySelector('svg'), 'default surface mode keeps play icon');
});

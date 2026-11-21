import assert from 'node:assert/strict';
import test from 'node:test';
import {
  stopCharacterVoicePreview,
  toggleCharacterVoicePreview,
} from '../src/shell/renderer/features/explore/character-voice-preview.js';
import { readCharacterCatalog } from '../src/shell/renderer/features/explore/character-catalog-data.js';
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
});

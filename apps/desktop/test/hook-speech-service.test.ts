import assert from 'node:assert/strict';
import test from 'node:test';

import { HookRuntimeSpeechService } from '../src/runtime/hook/services/speech-service';

test('listSpeechVoices fallback keeps model and connector context', async () => {
  const voiceCalls: Array<Record<string, unknown> | undefined> = [];
  const service = new HookRuntimeSpeechService({
    speechEngine: {
      listProviders: () => [],
      listVoices: async (input?: Record<string, unknown>) => {
        voiceCalls.push(input);
        return [{
          id: 'Cherry',
          providerId: 'dashscope',
          name: 'Cherry',
          lang: 'zh',
          langs: ['zh', 'en'],
        }];
      },
    } as never,
    audit: {
      append: () => {},
    } as never,
    evaluatePermission: () => ({ reasonCodes: [] }) as never,
    resolveRoute: async () => {
      throw new Error('route resolver unavailable');
    },
    ensureEventTopic: () => {},
  });

  const voices = await service.listSpeechVoices({
    modId: 'world.nimi.local-chat',
    routeSource: 'token-api',
    connectorId: 'connector-1',
    model: 'qwen3-tts-instruct-flash-2026-01-26',
  });

  assert.equal(voiceCalls.length, 1);
  assert.equal(voiceCalls[0]?.model, 'qwen3-tts-instruct-flash-2026-01-26');
  assert.equal(voiceCalls[0]?.routeSource, 'token-api');
  assert.equal(voiceCalls[0]?.connectorId, 'connector-1');
  assert.equal(voices.length, 1);
  assert.equal(voices[0]?.id, 'Cherry');
});

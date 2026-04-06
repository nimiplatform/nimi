import assert from 'node:assert/strict';
import test from 'node:test';

import { NimiSpeechEngine } from '../src/runtime/llm-adapter/speech/engine/index';

type CapturedListVoicesCall = Record<string, unknown>;

function createEngineForListVoicesTest(input: {
  capture: CapturedListVoicesCall[];
}): NimiSpeechEngine {
  return new NimiSpeechEngine({
    getRuntimeClient: () => ({
      media: {
        tts: {
          listVoices: async (payload: Record<string, unknown>) => {
            input.capture.push(payload);
            return {
              voices: [{
                voiceId: 'Cherry',
                name: 'Cherry',
                lang: 'zh',
                supportedLangs: ['zh', 'en'],
              }],
              modelResolved: 'qwen3-tts-instruct-flash-2026-01-26',
              traceId: 'trace-voice-list-test',
            };
          },
        },
      },
    }) as never,
    buildRuntimeRequestMetadata: async () => ({
      traceId: 'trace-voice-list-test',
      keySource: 'managed',
      'x-nimi-trace-id': 'trace-voice-list-test',
    }),
  });
}

test('listVoices without model fails close', async () => {
  const engine = new NimiSpeechEngine();
  await assert.rejects(
    () => engine.listVoices({}),
    (error: Error) => {
      assert.ok(error.message.includes('SPEECH_MODEL_REQUIRED'));
      return true;
    },
  );
});

test('listVoices with undefined input fails close', async () => {
  const engine = new NimiSpeechEngine();
  await assert.rejects(
    () => engine.listVoices(),
    (error: Error) => {
      assert.ok(error.message.includes('SPEECH_MODEL_REQUIRED'));
      return true;
    },
  );
});

test('listVoices with empty model string fails close', async () => {
  const engine = new NimiSpeechEngine();
  await assert.rejects(
    () => engine.listVoices({ model: '' }),
    (error: Error) => {
      assert.ok(error.message.includes('SPEECH_MODEL_REQUIRED'));
      return true;
    },
  );
});

test('listVoices cloud sends cloud-prefixed model and token route', async () => {
  const capture: CapturedListVoicesCall[] = [];
  const engine = createEngineForListVoicesTest({ capture });
  const voices = await engine.listVoices({
    model: 'qwen3-tts-instruct-flash-2026-01-26',
    routeSource: 'cloud',
  });

  assert.equal(capture.length, 1);
  assert.equal(capture[0]?.model, 'cloud/qwen3-tts-instruct-flash-2026-01-26');
  assert.equal(capture[0]?.route, 'cloud');
  assert.equal(capture[0]?.fallback, undefined);
  assert.equal(capture[0]?.subjectUserId, undefined);
  assert.equal(voices.length, 1);
  assert.equal(voices[0]?.id, 'Cherry');
});

test('listVoices local keeps model id and local route', async () => {
  const capture: CapturedListVoicesCall[] = [];
  const engine = createEngineForListVoicesTest({ capture });
  await engine.listVoices({
    model: 'local/tts-qwen',
    routeSource: 'local',
  });

  assert.equal(capture.length, 1);
  assert.equal(capture[0]?.model, 'local/tts-qwen');
  assert.equal(capture[0]?.route, 'local');
  assert.equal(capture[0]?.fallback, undefined);
});

test('openStream throws when no publisher configured', async () => {
  const engine = new NimiSpeechEngine();
  await assert.rejects(
    () => engine.openStream({
      model: 'tts-1',
      routeSource: 'cloud',
      request: { model: 'tts-1', text: 'hello', voice: 'alloy', format: 'mp3' },
      open: { format: 'mp3' },
    }),
    (error: Error) => {
      assert.ok(error.message.includes('SPEECH_STREAM_UNSUPPORTED'));
      return true;
    },
  );
});

test('controlStream returns ok false when no publisher', () => {
  const engine = new NimiSpeechEngine();
  assert.deepEqual(engine.controlStream('stream-1', 'pause'), { ok: false });
});

test('closeStream returns ok false when no publisher', () => {
  const engine = new NimiSpeechEngine();
  assert.deepEqual(engine.closeStream('stream-1'), { ok: false });
});

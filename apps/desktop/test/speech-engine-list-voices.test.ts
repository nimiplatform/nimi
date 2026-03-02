import assert from 'node:assert/strict';
import test from 'node:test';

import { NimiSpeechEngine } from '../src/runtime/llm-adapter/speech/engine/index';

test('listVoices without model returns empty array', async () => {
  const engine = new NimiSpeechEngine();
  const voices = await engine.listVoices({});
  assert.deepEqual(voices, []);
});

test('listVoices with undefined input returns empty array', async () => {
  const engine = new NimiSpeechEngine();
  const voices = await engine.listVoices();
  assert.deepEqual(voices, []);
});

test('listVoices with empty model string returns empty array', async () => {
  const engine = new NimiSpeechEngine();
  const voices = await engine.listVoices({ model: '' });
  assert.deepEqual(voices, []);
});

test('listProviders returns empty array', () => {
  const engine = new NimiSpeechEngine();
  assert.deepEqual(engine.listProviders(), []);
});

test('openStream throws when no publisher configured', async () => {
  const engine = new NimiSpeechEngine();
  await assert.rejects(
    () => engine.openStream({
      model: 'tts-1',
      routeSource: 'token-api',
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

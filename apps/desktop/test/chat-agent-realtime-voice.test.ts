import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAgentRealtimeTerminalError,
  createPcm16Resampler,
  interruptAgentRealtimeOutputBeforeClose,
  isEchoAwareBargeSpeech,
} from '../src/shell/renderer/features/chat/chat-agent-realtime-voice.js';

function sine(amplitude: number, cycles: number, length = 2_048): Float32Array {
  return Float32Array.from({ length }, (_, index) => amplitude * Math.sin((Math.PI * 2 * cycles * index) / length));
}

test('Realtime Voice flushes the bounded partial PCM tail before capture completion', () => {
  const resampler = createPcm16Resampler(48_000, 16_000);
  const complete = resampler.push(sine(0.3, 12, 2_048));
  assert.equal(complete.length, 0);
  const tail = resampler.flush();
  assert.equal(tail.length, 1);
  assert.ok(tail[0]!.byteLength > 0);
  assert.ok(tail[0]!.byteLength < 3_200);
  assert.equal(tail[0]!.byteLength % 2, 0);
});

test('Realtime Voice barge-in requires speech-like energy above the playback reference', () => {
  assert.equal(isEchoAwareBargeSpeech(sine(0.08, 20), 0.5), false);
  assert.equal(isEchoAwareBargeSpeech(sine(0.5, 20), 0.2), true);
  assert.equal(isEchoAwareBargeSpeech(Float32Array.from({ length: 2_048 }, () => 0.5), 0), false);
});

test('Realtime Voice interrupts the active output track before closing the session', async () => {
  const calls: string[] = [];
  let observedInterruptAgentTurn = false;
  await interruptAgentRealtimeOutputBeforeClose({
    outputTrackId: 'output-track-1',
    outputTerminal: false,
    interruptAgentTurn: true,
    stopPlayback: () => calls.push('stop-playback'),
    interruptOutput: async (outputTrackId, interruptAgentTurn) => {
      calls.push(`interrupt:${outputTrackId}`);
      observedInterruptAgentTurn = interruptAgentTurn;
    },
    close: async () => { calls.push('close'); },
  });
  assert.deepEqual(calls, ['stop-playback', 'interrupt:output-track-1', 'close']);
  assert.equal(observedInterruptAgentTurn, true);
});

test('Realtime Voice does not swallow an output interruption failure', async () => {
  const calls: string[] = [];
  await assert.rejects(
    interruptAgentRealtimeOutputBeforeClose({
      outputTrackId: 'output-track-2',
      outputTerminal: false,
      interruptAgentTurn: true,
      stopPlayback: () => calls.push('stop-playback'),
      interruptOutput: async () => {
        calls.push('interrupt');
        throw new Error('interrupt failed');
      },
      close: async () => { calls.push('close'); },
    }),
    /interrupt failed/,
  );
  assert.deepEqual(calls, ['stop-playback', 'interrupt', 'close']);
});

test('Realtime Voice stops terminal buffered playback without interrupting a closed remote track', async () => {
  const calls: string[] = [];
  await interruptAgentRealtimeOutputBeforeClose({
    outputTrackId: 'output-track-terminal',
    outputTerminal: true,
    interruptAgentTurn: false,
    stopPlayback: () => calls.push('stop-playback'),
    interruptOutput: async () => { calls.push('interrupt'); },
    close: async () => { calls.push('close'); },
  });
  assert.deepEqual(calls, ['stop-playback', 'close']);
});

test('Realtime Voice preserves a typed terminal reason', () => {
  const error = createAgentRealtimeTerminalError('AI_VOICE_INPUT_INVALID');
  assert.equal(error.reasonCode, 'AI_VOICE_INPUT_INVALID');
  assert.equal(error.actionHint, 'retry_voice_input');
  assert.match(error.message, /AI_VOICE_INPUT_INVALID/);
});

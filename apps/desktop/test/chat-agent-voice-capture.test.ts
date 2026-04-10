import assert from 'node:assert/strict';
import test from 'node:test';

import { startAgentVoiceCaptureSession } from '../src/shell/renderer/features/chat/chat-agent-voice-capture.js';

class FakeMediaRecorder {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: ((event: { error?: unknown }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(
    private readonly payload: Blob,
    mimeType?: string,
  ) {
    this.mimeType = mimeType || 'audio/webm';
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: this.payload });
    this.onstop?.();
  }
}

test('agent voice capture session returns typed audio bytes and stops tracks', async () => {
  let stoppedTracks = 0;
  const stream = {
    getTracks: () => [{
      stop: () => {
        stoppedTracks += 1;
      },
    }],
  };
  const session = await startAgentVoiceCaptureSession({
    getUserMediaImpl: async () => stream,
    createMediaRecorderImpl: (_stream, options) => new FakeMediaRecorder(
      new Blob([new Uint8Array([1, 2, 3])], { type: options?.mimeType || 'audio/webm' }),
      options?.mimeType,
    ),
    isTypeSupportedImpl: (mimeType) => mimeType === 'audio/webm',
  });

  const result = await session.stop();

  assert.equal(result.mimeType, 'audio/webm');
  assert.deepEqual([...result.bytes], [1, 2, 3]);
  assert.equal(stoppedTracks, 1);
});

test('agent voice capture session fail-closes when browser capture is unavailable', async () => {
  await assert.rejects(
    () => startAgentVoiceCaptureSession({
      getUserMediaImpl: undefined,
      createMediaRecorderImpl: undefined,
    }),
    /microphone capture is not supported/i,
  );
});

test('hands-free voice capture can auto-stop through the silence consumer seam', async () => {
  let stoppedTracks = 0;
  let requestStop!: () => void;
  const stream = {
    getTracks: () => [{
      stop: () => {
        stoppedTracks += 1;
      },
    }],
  };
  const session = await startAgentVoiceCaptureSession({
    autoStopMode: 'silence',
    getUserMediaImpl: async () => stream,
    createMediaRecorderImpl: (_stream, options) => new FakeMediaRecorder(
      new Blob([new Uint8Array([7, 8, 9])], { type: options?.mimeType || 'audio/webm' }),
      options?.mimeType,
    ),
    isTypeSupportedImpl: (mimeType) => mimeType === 'audio/webm',
    createSilenceAutoStopHandleImpl: (input) => {
      requestStop = input.requestStop;
      return {
        dispose: () => undefined,
      };
    },
  });

  requestStop();
  const result = await session.stop();

  assert.equal(result.mimeType, 'audio/webm');
  assert.deepEqual([...result.bytes], [7, 8, 9]);
  assert.equal(stoppedTracks, 1);
});

test('hands-free voice capture fails close when silence detection support is missing', async () => {
  const stream = {
    getTracks: () => [{
      stop: () => undefined,
    }],
  };

  await assert.rejects(
    () => startAgentVoiceCaptureSession({
      autoStopMode: 'silence',
      getUserMediaImpl: async () => stream,
      createMediaRecorderImpl: (_stream, options) => new FakeMediaRecorder(
        new Blob([new Uint8Array([1])], { type: options?.mimeType || 'audio/webm' }),
        options?.mimeType,
      ),
      isTypeSupportedImpl: (mimeType) => mimeType === 'audio/webm',
      createAudioContextImpl: undefined,
      createSilenceAutoStopHandleImpl: undefined,
    }),
    /silence detection is not supported/i,
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type AgentVoiceCaptureResult,
  startAgentVoiceCaptureSession,
} from '../src/shell/renderer/features/chat/chat-agent-voice-capture.js';

class FakeMediaRecorder {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: ((event: { error?: unknown }) => void) | null = null;
  onstop: (() => void) | null = null;
  startTimeslice: number | undefined;
  stopCalls = 0;

  constructor(
    private readonly payload: Blob,
    mimeType?: string,
    private readonly emitPayloadOnStop = true,
  ) {
    this.mimeType = mimeType || 'audio/webm';
  }

  start(timeslice?: number) {
    this.startTimeslice = timeslice;
    this.state = 'recording';
  }

  stop() {
    this.stopCalls += 1;
    this.state = 'inactive';
    if (this.emitPayloadOnStop) {
      this.ondataavailable?.({ data: this.payload });
    }
    this.onstop?.();
  }

  emit(data: Blob) {
    this.ondataavailable?.({ data });
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
  const autoStoppedRecordings: Promise<AgentVoiceCaptureResult>[] = [];
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
    onAutoStop: (recording) => {
      autoStoppedRecordings.push(recording);
    },
    createSilenceAutoStopHandleImpl: (input) => {
      requestStop = input.requestStop;
      return {
        dispose: () => undefined,
      };
    },
  });

  requestStop();
  const autoStoppedRecording = autoStoppedRecordings.at(0);
  if (!autoStoppedRecording) {
    assert.fail('expected silence auto-stop to expose the stopped recording');
  }
  const result = await autoStoppedRecording;

  assert.equal(result.mimeType, 'audio/webm');
  assert.deepEqual([...result.bytes], [7, 8, 9]);
  assert.equal(stoppedTracks, 1);
  await assert.doesNotReject(() => session.stop());
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

test('agent voice capture session emits live level callbacks while recording', async () => {
  const scheduled: Array<{ handler: () => void; timeoutMs: number }> = [];
  const observedLevels: number[] = [];
  const stream = {
    getTracks: () => [{
      stop: () => undefined,
    }],
  };
  let sampleIndex = 0;
  const analyser = {
    fftSize: 8,
    getByteTimeDomainData: (data: Uint8Array) => {
      const frames = [
        [128, 128, 128, 128, 128, 128, 128, 128],
        [128, 190, 64, 196, 60, 188, 70, 182],
      ];
      const frame = frames[Math.min(sampleIndex, frames.length - 1)]!;
      sampleIndex += 1;
      data.set(frame);
    },
    disconnect: () => undefined,
  };
  const audioContext = {
    createAnalyser: () => analyser,
    createMediaStreamSource: () => ({
      connect: () => undefined,
      disconnect: () => undefined,
    }),
    resume: async () => undefined,
    close: async () => undefined,
  };
  const session = await startAgentVoiceCaptureSession({
    getUserMediaImpl: async () => stream,
    createMediaRecorderImpl: (_stream, options) => new FakeMediaRecorder(
      new Blob([new Uint8Array([4, 5, 6])], { type: options?.mimeType || 'audio/webm' }),
      options?.mimeType,
    ),
    isTypeSupportedImpl: (mimeType) => mimeType === 'audio/webm',
    createAudioContextImpl: () => audioContext,
    setTimeoutImpl: (handler, timeoutMs) => {
      scheduled.push({ handler, timeoutMs });
      return scheduled.length;
    },
    clearTimeoutImpl: () => undefined,
    onLevelChange: (amplitude) => {
      observedLevels.push(amplitude);
    },
  });

  scheduled.find((timer) => timer.timeoutMs === 120)?.handler();
  scheduled.filter((timer) => timer.timeoutMs === 120).at(1)?.handler();
  await session.stop();

  assert.ok(observedLevels.some((level) => level === 0));
  assert.ok(observedLevels.some((level) => level > 0.25));
  assert.equal(observedLevels.at(-1), 0);
});

test('agent voice capture stops and rejects typed when recorded bytes exceed 6 MiB', async () => {
  const autoStoppedRecordings: Promise<AgentVoiceCaptureResult>[] = [];
  const recorderRef: { current: FakeMediaRecorder | null } = { current: null };
  let stoppedTracks = 0;
  await startAgentVoiceCaptureSession({
    getUserMediaImpl: async () => ({
      getTracks: () => [{
        stop: () => {
          stoppedTracks += 1;
        },
      }],
    }),
    createMediaRecorderImpl: (_stream, options) => {
      recorderRef.current = new FakeMediaRecorder(
        new Blob([], { type: options?.mimeType || 'audio/webm' }),
        options?.mimeType,
        false,
      );
      return recorderRef.current;
    },
    isTypeSupportedImpl: (mimeType) => mimeType === 'audio/webm',
    onAutoStop: (recording) => {
      autoStoppedRecordings.push(recording);
    },
  });

  const recorder = recorderRef.current;
  if (!recorder) {
    assert.fail('expected the fake recorder to be created');
  }
  recorder.emit(new Blob([new Uint8Array(6 * 1024 * 1024)]));
  assert.equal(recorder.stopCalls, 0, 'exactly 6 MiB must remain admitted');
  recorder.emit(new Blob([new Uint8Array([1])]));

  assert.equal(recorder.stopCalls, 1);
  assert.equal(recorder.startTimeslice, 1000);
  const recording = autoStoppedRecordings.at(0);
  if (!recording) {
    assert.fail('expected the byte limit to expose the stopped recording');
  }
  await assert.rejects(recording, (error: unknown) => {
    const typed = error as { code?: unknown; reasonCode?: unknown; actionHint?: unknown; retryable?: unknown };
    assert.equal(typed.code, 'AI_AUDIO_INPUT_TOO_LARGE');
    assert.equal(typed.reasonCode, 'AI_AUDIO_INPUT_TOO_LARGE');
    assert.equal(typed.actionHint, 'record_shorter_audio_input');
    assert.equal(typed.retryable, false);
    return true;
  });
  assert.equal(stoppedTracks, 1);
});

test('agent voice capture stops and rejects typed at the 5-minute duration bound', async () => {
  const scheduled: Array<{ handler: () => void; timeoutMs: number }> = [];
  const autoStoppedRecordings: Promise<AgentVoiceCaptureResult>[] = [];
  const recorderRef: { current: FakeMediaRecorder | null } = { current: null };
  await startAgentVoiceCaptureSession({
    getUserMediaImpl: async () => ({
      getTracks: () => [{ stop: () => undefined }],
    }),
    createMediaRecorderImpl: (_stream, options) => {
      recorderRef.current = new FakeMediaRecorder(
        new Blob([], { type: options?.mimeType || 'audio/webm' }),
        options?.mimeType,
        false,
      );
      return recorderRef.current;
    },
    isTypeSupportedImpl: (mimeType) => mimeType === 'audio/webm',
    setTimeoutImpl: (handler, timeoutMs) => {
      scheduled.push({ handler, timeoutMs });
      return scheduled.length;
    },
    clearTimeoutImpl: () => undefined,
    onAutoStop: (recording) => {
      autoStoppedRecordings.push(recording);
    },
  });

  const durationTimer = scheduled.find((timer) => timer.timeoutMs === 5 * 60 * 1000);
  assert.ok(durationTimer);
  durationTimer.handler();

  assert.equal(recorderRef.current?.stopCalls, 1);
  const recording = autoStoppedRecordings.at(0);
  if (!recording) {
    assert.fail('expected the duration limit to expose the stopped recording');
  }
  await assert.rejects(recording, (error: unknown) => (
    (error as { reasonCode?: unknown }).reasonCode === 'AI_AUDIO_INPUT_TOO_LARGE'
  ));
});

import { requireZhiyuLocalAppCapability } from '../auth/runtime-platform';
import {
  voiceCaptureEvidence,
  type ZhiyuVoiceCaptureEvidence,
} from './voice-capture-evidence';
export {
  createInitialZhiyuVoiceCaptureEvidence,
  type ZhiyuVoiceCaptureEvidence,
  type ZhiyuVoiceCaptureState,
} from './voice-capture-evidence';

export type ZhiyuVoiceCaptureRecorder = {
  readonly mimeType: string;
  readonly start: () => Promise<void> | void;
  readonly stop: () => Promise<{
    readonly bytes: Uint8Array;
    readonly mimeType: string;
  }>;
};

export type ZhiyuVoiceCaptureTranscribeInput = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly requestId: string;
};

export type ZhiyuVoiceCaptureTranscribeResult = {
  readonly text: string;
  readonly jobId?: string;
  readonly traceId?: string;
};

export type ZhiyuVoiceCaptureControllerOptions = {
  readonly createRecorder: () => Promise<ZhiyuVoiceCaptureRecorder> | ZhiyuVoiceCaptureRecorder;
  readonly transcribe: (input: ZhiyuVoiceCaptureTranscribeInput) => Promise<ZhiyuVoiceCaptureTranscribeResult>;
  readonly onStateChange?: (state: ZhiyuVoiceCaptureEvidence) => void;
  readonly createRequestId?: () => string;
};


export function createZhiyuVoiceCaptureController(options: ZhiyuVoiceCaptureControllerOptions): {
  readonly start: () => Promise<ZhiyuVoiceCaptureEvidence>;
  readonly stop: () => Promise<ZhiyuVoiceCaptureEvidence>;
} {
  let recorder: ZhiyuVoiceCaptureRecorder | null = null;
  let requestId = '';
  const emit = (state: ZhiyuVoiceCaptureEvidence) => {
    options.onStateChange?.(state);
    return state;
  };
  return {
    async start() {
      requestId = normalizeVoiceCaptureText(options.createRequestId?.()) || createVoiceCaptureRequestId();
      const recording = emit(voiceCaptureEvidence({
        state: 'recording',
        reasonCode: 'runtime-voice-capture-recording',
        actionHint: 'stop_voice_capture',
        message: 'Voice capture is recording microphone audio for Runtime transcription.',
        requestId,
      }));
      try {
        recorder = await options.createRecorder();
        await recorder.start();
        return recording;
      } catch (error) {
        recorder = null;
        return emit(voiceCaptureError(error, recording, 'runtime-voice-capture-recording-failed'));
      }
    },
    async stop() {
      if (!recorder) {
        return emit(voiceCaptureEvidence({
          state: 'failed',
          reasonCode: 'runtime-voice-capture-recorder-missing',
          actionHint: 'start_voice_capture',
          source: 'renderer',
          message: 'Voice capture stop was requested before recording started.',
          requestId: requestId || null,
        }));
      }
      const transcribing = emit(voiceCaptureEvidence({
        state: 'transcribing',
        reasonCode: 'runtime-voice-capture-transcribing',
        actionHint: 'wait_runtime_speech_transcription',
        message: 'Runtime audio.transcribe scenario is transcribing the captured audio.',
        requestId,
      }));
      try {
        const activeRecorder = recorder;
        const recorded = await activeRecorder.stop();
        recorder = null;
        const bytes = requireVoiceCaptureBytes(recorded.bytes);
        const mimeType = normalizeVoiceCaptureText(recorded.mimeType) || normalizeVoiceCaptureText(activeRecorder.mimeType) || 'audio/webm';
        const result = await options.transcribe({
          bytes,
          mimeType,
          requestId,
        });
        const transcriptText = normalizeVoiceCaptureText(result.text);
        if (!transcriptText) {
          throw Object.assign(new Error('Runtime speech transcription returned no transcript text.'), {
            reasonCode: 'runtime-voice-capture-empty-transcript',
            actionHint: 'retry_voice_capture',
            source: 'runtime',
          });
        }
        return emit({
          ...transcribing,
          state: 'idle',
          reasonCode: 'runtime-voice-capture-transcribed',
          actionHint: 'review_transcribed_draft',
          message: 'Runtime audio.transcribe returned transcript text.',
          transcriptText,
          transcriptLength: transcriptText.length,
        });
      } catch (error) {
        recorder = null;
        return emit(voiceCaptureError(error, {
          ...transcribing,
          transcriptText: '',
          transcriptLength: 0,
        }, 'runtime-voice-capture-transcription-failed'));
      }
    },
  };
}

export function createBrowserVoiceCaptureRecorder(): Promise<ZhiyuVoiceCaptureRecorder> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('Microphone capture is unavailable in this renderer.'), {
      reasonCode: 'runtime-voice-capture-media-device-unavailable',
      actionHint: 'grant_microphone_permission',
      source: 'renderer',
    });
  }
  return createMediaRecorder(navigator.mediaDevices.getUserMedia({ audio: true }));
}

export function createElectronVoiceCaptureTranscriber(input: {
  readonly agentId: string;
  readonly ownerUserId: string;
}): (request: ZhiyuVoiceCaptureTranscribeInput) => Promise<ZhiyuVoiceCaptureTranscribeResult> {
  const agentId = normalizeVoiceCaptureText(input.agentId);
  const ownerUserId = normalizeVoiceCaptureText(input.ownerUserId);
  if (!agentId) {
    throw Object.assign(new Error('Runtime Agent identity is required for voice transcription.'), {
      reasonCode: 'runtime-voice-capture-agent-required',
      actionHint: 'select_runtime_local_agent',
      source: 'runtime',
    });
  }
  if (!ownerUserId) {
    throw Object.assign(new Error('Runtime account identity is required for voice transcription.'), {
      reasonCode: 'runtime-voice-capture-owner-required',
      actionHint: 'authenticate_runtime_account',
      source: 'runtime',
    });
  }
  return async (request) => {
    void request;
    return requireZhiyuLocalAppCapability('voice-transcription');
  };
}

async function createMediaRecorder(streamPromise: Promise<MediaStream>): Promise<ZhiyuVoiceCaptureRecorder> {
  const stream = await streamPromise;
  const mimeType = preferredVoiceCaptureMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  });
  return {
    mimeType: recorder.mimeType || mimeType || 'audio/webm',
    start() {
      recorder.start();
    },
    stop() {
      return new Promise((resolve, reject) => {
        recorder.addEventListener('error', () => reject(Object.assign(new Error('MediaRecorder failed.'), {
          reasonCode: 'runtime-voice-capture-media-recorder-failed',
          actionHint: 'retry_voice_capture',
          source: 'renderer',
        })), { once: true });
        recorder.addEventListener('stop', async () => {
          try {
            for (const track of stream.getTracks()) {
              track.stop();
            }
            const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
            resolve({
              bytes: new Uint8Array(await blob.arrayBuffer()),
              mimeType: blob.type || recorder.mimeType || mimeType || 'audio/webm',
            });
          } catch (error) {
            reject(error);
          }
        }, { once: true });
        recorder.stop();
      });
    },
  };
}

function voiceCaptureError(
  error: unknown,
  current: ZhiyuVoiceCaptureEvidence,
  fallbackReasonCode: string,
): ZhiyuVoiceCaptureEvidence {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'Runtime voice capture failed.';
  return {
    ...current,
    state: 'failed',
    reasonCode: normalizeVoiceCaptureText(record.reasonCode) || fallbackReasonCode,
    actionHint: normalizeVoiceCaptureText(record.actionHint) || 'retry_voice_capture',
    source: normalizeVoiceCaptureText(record.source) || 'runtime',
    message,
    transcriptText: '',
    transcriptLength: 0,
  };
}

function requireVoiceCaptureBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array && value.byteLength > 0) {
    return value;
  }
  throw Object.assign(new Error('Voice capture produced no audio bytes.'), {
    reasonCode: 'runtime-voice-capture-audio-empty',
    actionHint: 'retry_voice_capture',
    source: 'renderer',
  });
}

function preferredVoiceCaptureMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/wav'];
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return 'audio/webm';
  }
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || 'audio/webm';
}

function createVoiceCaptureRequestId(): string {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `zhiyu-voice-capture-${randomId}`;
}

function normalizeVoiceCaptureText(value: unknown): string {
  return String(value ?? '').trim();
}

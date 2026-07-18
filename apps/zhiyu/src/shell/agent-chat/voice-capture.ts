import type { ZhiyuEvidence } from '../app/evidence';
import { runNimiRuntimeSpeechTranscription } from '@nimiplatform/sdk/features/generation';
import { appId, getRuntimePlatformProjection } from '../auth/runtime-platform';

export type ZhiyuVoiceCaptureState = 'idle' | 'recording' | 'transcribing' | 'failed';

export type ZhiyuVoiceCaptureEvidence = {
  readonly transport: 'electron-media-recorder';
  readonly ready: boolean;
  readonly state: ZhiyuVoiceCaptureState;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly capability: 'audio.transcribe';
  readonly runtimeBindingModelId: string | null;
  readonly connectorId: string | null;
  readonly requestId: string | null;
  readonly transcriptText: string;
  readonly transcriptLength: number;
};

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
  readonly readiness: ZhiyuVoiceCaptureEvidence;
  readonly createRecorder: () => Promise<ZhiyuVoiceCaptureRecorder> | ZhiyuVoiceCaptureRecorder;
  readonly transcribe: (input: ZhiyuVoiceCaptureTranscribeInput) => Promise<ZhiyuVoiceCaptureTranscribeResult>;
  readonly onStateChange?: (state: ZhiyuVoiceCaptureEvidence) => void;
  readonly createRequestId?: () => string;
};

export function createInitialZhiyuVoiceCaptureEvidence(): ZhiyuVoiceCaptureEvidence {
  return voiceCaptureEvidence({
    ready: false,
    state: 'failed',
    reasonCode: 'runtime-voice-capture-not-probed',
    actionHint: 'probe_runtime_agent_ai_config',
    source: 'renderer',
    message: 'Runtime voice capture readiness has not been projected.',
  });
}

export function projectZhiyuVoiceCaptureReadiness(
  route: Pick<ZhiyuEvidence['route'], 'capabilities'> | { readonly capabilities?: unknown },
): ZhiyuVoiceCaptureEvidence {
  const capabilities = route.capabilities && typeof route.capabilities === 'object'
    ? route.capabilities as Record<string, unknown>
    : {};
  const capability = capabilities['audio.transcribe'];
  const record = capability && typeof capability === 'object' ? capability as Record<string, unknown> : {};
  const binding = record.binding && typeof record.binding === 'object'
    ? record.binding as Record<string, unknown>
    : null;
  const state = normalizeVoiceCaptureText(record.state);
  if (state === 'ready' && binding) {
    return voiceCaptureEvidence({
      ready: true,
      state: 'idle',
      reasonCode: 'runtime-voice-capture-ready',
      actionHint: 'start_voice_capture',
      source: 'runtime',
      message: 'Runtime audio.transcribe route is ready for voice capture.',
      runtimeBindingModelId: normalizeVoiceCaptureText(binding.modelId) || null,
      connectorId: normalizeVoiceCaptureText(binding.connectorId) || null,
    });
  }
  return voiceCaptureEvidence({
    ready: false,
    state: 'failed',
    reasonCode: 'runtime-voice-capture-route-not-ready',
    actionHint: 'configure_audio_transcribe_route',
    source: 'runtime',
    message: 'Runtime audio.transcribe route is not ready.',
    runtimeBindingModelId: binding ? normalizeVoiceCaptureText(binding.modelId) || null : null,
    connectorId: binding ? normalizeVoiceCaptureText(binding.connectorId) || null : null,
  });
}

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
      if (!options.readiness.ready) {
        return emit({
          ...options.readiness,
          ready: false,
          state: 'failed',
          reasonCode: 'runtime-voice-capture-route-not-ready',
          actionHint: 'configure_audio_transcribe_route',
          message: 'Runtime audio.transcribe route is not ready.',
        });
      }
      requestId = normalizeVoiceCaptureText(options.createRequestId?.()) || createVoiceCaptureRequestId();
      const recording = emit({
        ...options.readiness,
        state: 'recording',
        reasonCode: 'runtime-voice-capture-recording',
        actionHint: 'stop_voice_capture',
        message: 'Voice capture is recording microphone audio for Runtime transcription.',
        requestId,
      });
      try {
        recorder = await options.createRecorder();
        await recorder.start();
        return recording;
      } catch (error) {
        recorder = null;
        return emit(voiceCaptureError(error, {
          ...options.readiness,
          requestId,
        }, 'runtime-voice-capture-recording-failed'));
      }
    },
    async stop() {
      if (!recorder) {
        return emit({
          ...options.readiness,
          ready: false,
          state: 'failed',
          reasonCode: 'runtime-voice-capture-recorder-missing',
          actionHint: 'start_voice_capture',
          source: 'renderer',
          message: 'Voice capture stop was requested before recording started.',
          requestId: requestId || null,
        });
      }
      const transcribing = emit({
        ...options.readiness,
        state: 'transcribing',
        reasonCode: 'runtime-voice-capture-transcribing',
        actionHint: 'wait_runtime_speech_transcription',
        message: 'Runtime audio.transcribe scenario is transcribing the captured audio.',
        requestId,
      });
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
    const projection = await getRuntimePlatformProjection();
    if (projection.status !== 'ready') {
      throw Object.assign(new Error(projection.message), {
        reasonCode: projection.reasonCode,
        actionHint: projection.actionHint || 'start_external_runtime_daemon',
        source: 'runtime',
      });
    }
    const result = await runNimiRuntimeSpeechTranscription({
      runtime: projection.accountRuntime,
      head: {
        appId,
        subjectUserId: ownerUserId,
      },
      audio: { type: 'bytes', bytes: request.bytes },
      mimeType: request.mimeType,
      requestId: request.requestId,
      idempotencyKey: `${appId}:voice-transcription:${request.requestId}`,
      labels: {
        surface: 'zhiyu.agent-chat',
        localAgentRef: agentId,
      },
    });
    return {
      text: result.text,
      jobId: result.job.jobId,
      traceId: result.traceId,
    };
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

function voiceCaptureEvidence(input: Partial<ZhiyuVoiceCaptureEvidence>): ZhiyuVoiceCaptureEvidence {
  return {
    transport: 'electron-media-recorder',
    ready: input.ready ?? false,
    state: input.state ?? 'failed',
    reasonCode: input.reasonCode ?? 'runtime-voice-capture-unavailable',
    actionHint: input.actionHint ?? 'configure_audio_transcribe_route',
    source: input.source ?? 'renderer',
    message: input.message ?? 'Runtime voice capture is unavailable.',
    capability: 'audio.transcribe',
    runtimeBindingModelId: input.runtimeBindingModelId ?? null,
    connectorId: input.connectorId ?? null,
    requestId: input.requestId ?? null,
    transcriptText: input.transcriptText ?? '',
    transcriptLength: input.transcriptLength ?? 0,
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
    ready: false,
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

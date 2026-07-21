import type { ZhiyuEvidence } from '../app/evidence.js';

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

export function voiceCaptureEvidence(input: Partial<ZhiyuVoiceCaptureEvidence>): ZhiyuVoiceCaptureEvidence {
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

function normalizeVoiceCaptureText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

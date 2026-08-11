import {
  createNimiError,
  ReasonCode,
  type NimiError,
} from '../types/index.js';

export const NIMI_RUNTIME_AGENT_VOICE_INPUT_MAX_BYTES = 6 * 1024 * 1024;
export const NIMI_RUNTIME_AGENT_VOICE_INPUT_MAX_DURATION_MS = 5 * 60 * 1000;

const AI_LOCAL_EXECUTION_CANCELED = 'AI_LOCAL_EXECUTION_CANCELED';

export function createNimiRuntimeAgentVoiceInputTooLargeError(): NimiError {
  return createNimiError({
    message: 'Recorded audio exceeds the 5-minute or 6 MiB voice-input limit.',
    code: ReasonCode.AI_AUDIO_INPUT_TOO_LARGE,
    reasonCode: ReasonCode.AI_AUDIO_INPUT_TOO_LARGE,
    actionHint: 'record_shorter_audio_input',
    retryable: false,
    source: 'sdk',
  });
}

export function isNimiRuntimeAgentCanceledError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return false;
  }
  const typed = error as { name?: unknown; code?: unknown; reasonCode?: unknown };
  return typed.name === 'AbortError'
    || typed.code === ReasonCode.RUNTIME_GRPC_CANCELLED
    || typed.reasonCode === ReasonCode.RUNTIME_GRPC_CANCELLED
    || typed.code === AI_LOCAL_EXECUTION_CANCELED
    || typed.reasonCode === AI_LOCAL_EXECUTION_CANCELED;
}

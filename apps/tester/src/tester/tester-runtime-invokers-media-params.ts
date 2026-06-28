import {
  audioBytesFromNimiUrl,
  coerceNimiImageGenerationParams,
  coerceNimiSpeechTranscriptionParams,
  coerceNimiVideoGenerationParams,
  type NimiImageGenerationCoercedParams,
  type NimiSpeechTranscriptionCoercedParams,
  type NimiVideoGenerationCoercedParams,
} from '@nimiplatform/sdk/features/generation';
import type { ResolvedLLMBinding } from './tester-runtime-invokers-core.js';
import { isTesterUnavailable, unavailableFromValidation } from './tester-runtime-invokers-core.js';
import type { TesterUnavailable } from './tester-unavailable.js';

type MediaParamCapabilityId = 'image.generate' | 'video.generate' | 'audio.transcribe';

function selectedParamRecord(resolved: ResolvedLLMBinding): Record<string, unknown> {
  return resolved.selectedParams && typeof resolved.selectedParams === 'object' && !Array.isArray(resolved.selectedParams)
    ? resolved.selectedParams as Record<string, unknown>
    : {};
}

function describeSdkValidation(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || 'NimiAIConfig selectedParams are invalid.';
  }
  return String(error || 'NimiAIConfig selectedParams are invalid.');
}

function fromSdkValidation<T>(capabilityId: MediaParamCapabilityId, run: () => T): T | TesterUnavailable {
  try {
    return run();
  } catch (error) {
    return unavailableFromValidation(capabilityId, describeSdkValidation(error));
  }
}

export function isUnavailable(value: unknown): value is TesterUnavailable {
  return isTesterUnavailable(value);
}

export function imageParamsFromBinding(resolved: ResolvedLLMBinding): NimiImageGenerationCoercedParams | TesterUnavailable {
  return fromSdkValidation('image.generate', () => coerceNimiImageGenerationParams(selectedParamRecord(resolved)));
}

export function videoParamsFromBinding(resolved: ResolvedLLMBinding): NimiVideoGenerationCoercedParams | TesterUnavailable {
  return fromSdkValidation('video.generate', () => coerceNimiVideoGenerationParams(selectedParamRecord(resolved)));
}

export function transcriptionParamsFromBinding(
  resolved: ResolvedLLMBinding,
): NimiSpeechTranscriptionCoercedParams | TesterUnavailable {
  return fromSdkValidation('audio.transcribe', () => coerceNimiSpeechTranscriptionParams(selectedParamRecord(resolved)));
}

export const audioBytesFromUrl = audioBytesFromNimiUrl;

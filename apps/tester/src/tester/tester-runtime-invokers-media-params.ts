import type { ResolvedLLMBinding } from './tester-runtime-invokers-core.js';
import { isTesterUnavailable, unavailableFromValidation } from './tester-runtime-invokers-core.js';
import type { TesterUnavailable } from './tester-unavailable.js';

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function selectedParamRecord(resolved: ResolvedLLMBinding): Record<string, unknown> {
  return resolved.selectedParams && typeof resolved.selectedParams === 'object' && !Array.isArray(resolved.selectedParams)
    ? resolved.selectedParams as Record<string, unknown>
    : {};
}

function optionalFiniteNumber(
  capabilityId: 'video.generate' | 'audio.transcribe',
  value: unknown,
  fieldName: string,
): number | TesterUnavailable | undefined {
  const raw = typeof value === 'number' ? String(value) : optionalText(value);
  if (!raw || raw.toLowerCase() === 'default' || raw.toLowerCase() === 'auto') return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return unavailableFromValidation(capabilityId, `NimiAIConfig selectedParams.${fieldName} must be a finite number.`);
  }
  return parsed;
}

function optionalPositiveInteger(
  capabilityId: 'video.generate' | 'audio.transcribe',
  value: unknown,
  fieldName: string,
): number | TesterUnavailable | undefined {
  const parsed = optionalFiniteNumber(capabilityId, value, fieldName);
  if (parsed === undefined || isTesterUnavailable(parsed)) return parsed;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return unavailableFromValidation(capabilityId, `NimiAIConfig selectedParams.${fieldName} must be a positive integer.`);
  }
  return parsed;
}

export function isUnavailable(value: unknown): value is TesterUnavailable {
  return isTesterUnavailable(value);
}

function booleanParam(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function videoParamsFromBinding(resolved: ResolvedLLMBinding): {
  mode: 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference';
  negativePrompt?: string;
  options: {
    ratio?: string;
    durationSec?: number;
    resolution?: string;
    fps?: number;
    seed?: string;
    cameraFixed?: boolean;
    generateAudio?: boolean;
  };
  timeoutMs?: number;
} | TesterUnavailable {
  const params = selectedParamRecord(resolved);
  const mode = optionalText(params.mode) || 't2v';
  if (!['t2v', 'i2v-first-frame', 'i2v-first-last', 'i2v-reference'].includes(mode)) {
    return unavailableFromValidation('video.generate', `NimiAIConfig selectedParams.mode is not supported: ${mode}.`);
  }
  const durationSec = optionalFiniteNumber('video.generate', params.durationSec, 'durationSec');
  if (isUnavailable(durationSec)) return durationSec;
  const fps = optionalPositiveInteger('video.generate', params.fps, 'fps');
  if (isUnavailable(fps)) return fps;
  const timeoutMs = optionalPositiveInteger('video.generate', params.timeoutMs, 'timeoutMs');
  if (isUnavailable(timeoutMs)) return timeoutMs;
  return {
    mode: mode as 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference',
    negativePrompt: optionalText(params.negativePrompt) || undefined,
    options: {
      ratio: optionalText(params.ratio) || undefined,
      durationSec,
      resolution: optionalText(params.resolution) || undefined,
      fps,
      seed: optionalText(params.seed) || undefined,
      cameraFixed: booleanParam(params.cameraFixed),
      generateAudio: booleanParam(params.generateAudio),
    },
    timeoutMs,
  };
}

export function transcriptionParamsFromBinding(resolved: ResolvedLLMBinding): {
  language?: string;
  responseFormat?: string;
  speakerCount?: number;
  prompt?: string;
  timestamps?: boolean;
  diarization?: boolean;
  timeoutMs?: number;
} | TesterUnavailable {
  const params = selectedParamRecord(resolved);
  const speakerCount = optionalPositiveInteger('audio.transcribe', params.speakerCount, 'speakerCount');
  if (isUnavailable(speakerCount)) return speakerCount;
  const timeoutMs = optionalPositiveInteger('audio.transcribe', params.timeoutMs, 'timeoutMs');
  if (isUnavailable(timeoutMs)) return timeoutMs;
  return {
    language: optionalText(params.language) || undefined,
    responseFormat: optionalText(params.responseFormat) || undefined,
    speakerCount,
    prompt: optionalText(params.prompt) || undefined,
    timestamps: booleanParam(params.timestamps),
    diarization: booleanParam(params.diarization),
    timeoutMs,
  };
}

function mimeTypeForAudioUrl(url: string, contentType?: string | null): string {
  const normalizedContentType = optionalText(contentType).split(';')[0]?.trim();
  if (normalizedContentType) return normalizedContentType;
  const lower = url.toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.flac')) return 'audio/flac';
  return 'audio/wav';
}

export async function audioBytesFromUrl(url: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`audio.transcribe audio fetch failed (${response.status}) for ${url}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error('audio.transcribe audio fetch returned an empty body.');
  }
  return {
    bytes,
    mimeType: mimeTypeForAudioUrl(url, response.headers.get('content-type')),
  };
}

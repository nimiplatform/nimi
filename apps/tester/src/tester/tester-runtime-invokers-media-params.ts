import type { ResolvedLLMBinding } from './tester-runtime-invokers-core.js';
import { isTesterUnavailable, unavailableFromValidation } from './tester-runtime-invokers-core.js';
import type { TesterUnavailable } from './tester-unavailable.js';
import type { JsonObject } from '@nimiplatform/sdk/types';

type MediaParamCapabilityId = 'image.generate' | 'video.generate' | 'audio.transcribe';

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function selectedParamRecord(resolved: ResolvedLLMBinding): Record<string, unknown> {
  return resolved.selectedParams && typeof resolved.selectedParams === 'object' && !Array.isArray(resolved.selectedParams)
    ? resolved.selectedParams as Record<string, unknown>
    : {};
}

function optionalFiniteNumber(
  capabilityId: MediaParamCapabilityId,
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
  capabilityId: MediaParamCapabilityId,
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

function optionalDefaultText(value: unknown, extraSentinels: readonly string[] = []): string | undefined {
  const raw = typeof value === 'number' || typeof value === 'bigint' ? String(value) : optionalText(value);
  const normalized = raw.trim();
  if (!normalized) return undefined;
  const lower = normalized.toLowerCase();
  if (lower === 'default' || lower === 'auto' || extraSentinels.includes(lower)) return undefined;
  return normalized;
}

function optionalImageSize(value: unknown): string | TesterUnavailable | undefined {
  const text = optionalDefaultText(value);
  if (!text) return undefined;
  const normalized = text.toLowerCase();
  if (/^\d+x\d+$/u.test(normalized) || /^[234]k$/u.test(normalized)) {
    return normalized;
  }
  return unavailableFromValidation('image.generate', 'NimiAIConfig selectedParams.size must use WIDTHxHEIGHT, 2k, 3k, or 4k format.');
}

function optionalImageResponseFormat(value: unknown): string | TesterUnavailable | undefined {
  const text = optionalDefaultText(value);
  if (!text) return undefined;
  const normalized = text.toLowerCase();
  if (normalized === 'base64' || normalized === 'b64_json' || normalized === 'url') {
    return normalized;
  }
  return unavailableFromValidation('image.generate', `NimiAIConfig selectedParams.responseFormat is not supported: ${text}.`);
}

function optionalImageIntegerString(
  value: unknown,
  fieldName: string,
  extraSentinels: readonly string[] = [],
): string | TesterUnavailable | undefined {
  const text = optionalDefaultText(value, extraSentinels);
  if (!text) return undefined;
  if (!/^-?\d+$/u.test(text)) {
    return unavailableFromValidation('image.generate', `NimiAIConfig selectedParams.${fieldName} must be an integer.`);
  }
  return text;
}

function optionalImageStringList(value: unknown, fieldName: string): readonly string[] | TesterUnavailable | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const out = value.map(optionalText).filter(Boolean);
    if (out.length !== value.length) {
      return unavailableFromValidation('image.generate', `NimiAIConfig selectedParams.${fieldName} must contain only non-empty strings.`);
    }
    return out;
  }
  const text = optionalDefaultText(value);
  return text ? [text] : undefined;
}

function optionalPositiveNumber(
  capabilityId: MediaParamCapabilityId,
  value: unknown,
  fieldName: string,
): number | TesterUnavailable | undefined {
  const parsed = optionalFiniteNumber(capabilityId, value, fieldName);
  if (parsed === undefined || isTesterUnavailable(parsed)) return parsed;
  if (parsed <= 0) {
    return unavailableFromValidation(capabilityId, `NimiAIConfig selectedParams.${fieldName} must be greater than zero.`);
  }
  return parsed;
}

function optionalImageSampler(value: unknown): string | TesterUnavailable | undefined {
  const text = optionalDefaultText(value);
  if (!text) return undefined;
  const normalized = text.toLowerCase();
  const aliases: Record<string, string> = {
    euler_a: 'euler_a',
    euler: 'euler',
    heun: 'heun',
    dpm2: 'dpm2',
    dpmpp2s_a: 'dpmpp2s_a',
    'dpm++2s_a': 'dpmpp2s_a',
    dpmpp2m: 'dpmpp2m',
    'dpm++2m': 'dpmpp2m',
    dpmpp2mv2: 'dpmpp2mv2',
    'dpm++2mv2': 'dpmpp2mv2',
    ipndm: 'ipndm',
    ipndm_v: 'ipndm_v',
    lcm: 'lcm',
  };
  const sampler = aliases[normalized];
  if (sampler) return sampler;
  return unavailableFromValidation('image.generate', `NimiAIConfig selectedParams.sampler is not supported: ${text}.`);
}

function optionalImageScheduler(value: unknown): string | TesterUnavailable | undefined {
  const text = optionalDefaultText(value);
  if (!text) return undefined;
  const normalized = text.toLowerCase();
  const allowed = new Set([
    'discrete',
    'karras',
    'exponential',
    'ays',
    'gits',
    'smoothstep',
    'sgm_uniform',
    'simple',
    'kl_optimal',
    'lcm',
    'bong_tangent',
  ]);
  if (allowed.has(normalized)) return normalized;
  return unavailableFromValidation('image.generate', `NimiAIConfig selectedParams.scheduler is not supported: ${text}.`);
}

export function imageParamsFromBinding(resolved: ResolvedLLMBinding): {
  negativePrompt?: string;
  count?: number;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  style?: string;
  seed?: string;
  referenceImages?: readonly string[];
  mask?: string;
  responseFormat?: string;
  timeoutMs?: number;
  providerOptions: JsonObject;
} | TesterUnavailable {
  const params = selectedParamRecord(resolved);
  const size = optionalImageSize(params.size);
  if (isUnavailable(size)) return size;
  const responseFormat = optionalImageResponseFormat(params.responseFormat ?? params.response_format);
  if (isUnavailable(responseFormat)) return responseFormat;
  const seed = optionalImageIntegerString(params.seed, 'seed', ['random']);
  if (isUnavailable(seed)) return seed;
  const count = optionalPositiveInteger('image.generate', params.count ?? params.n, 'count');
  if (isUnavailable(count)) return count;
  const timeoutMs = optionalPositiveInteger('image.generate', params.timeoutMs ?? params.timeout_ms, 'timeoutMs');
  if (isUnavailable(timeoutMs)) return timeoutMs;
  const steps = optionalPositiveInteger('image.generate', params.steps ?? params.step, 'steps');
  if (isUnavailable(steps)) return steps;
  const cfgScale = optionalPositiveNumber('image.generate', params.cfgScale ?? params.cfg_scale, 'cfgScale');
  if (isUnavailable(cfgScale)) return cfgScale;
  const sampler = optionalImageSampler(params.sampler ?? params.mode ?? params.method);
  if (isUnavailable(sampler)) return sampler;
  const scheduler = optionalImageScheduler(params.scheduler);
  if (isUnavailable(scheduler)) return scheduler;
  const referenceImages = optionalImageStringList(params.referenceImages ?? params.reference_images, 'referenceImages');
  if (isUnavailable(referenceImages)) return referenceImages;

  const providerOptions: JsonObject = {};
  if (steps !== undefined) providerOptions.steps = steps;
  if (cfgScale !== undefined) providerOptions.cfgScale = cfgScale;
  if (sampler) providerOptions.mode = sampler;
  if (scheduler) providerOptions.scheduler = scheduler;

  return {
    negativePrompt: optionalDefaultText(params.negativePrompt ?? params.negative_prompt),
    count,
    size,
    aspectRatio: optionalDefaultText(params.aspectRatio ?? params.aspect_ratio),
    quality: optionalDefaultText(params.quality),
    style: optionalDefaultText(params.style),
    seed,
    referenceImages,
    mask: optionalDefaultText(params.mask),
    responseFormat,
    timeoutMs,
    providerOptions,
  };
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

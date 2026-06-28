import type { NimiJsonObject, NimiJsonValue } from '../../core/contracts';
import { createNimiError, ReasonCode } from '../../types';

export type NimiRuntimeMediaParamCapabilityId = 'image.generate' | 'video.generate' | 'audio.transcribe';

export interface NimiImageGenerationCoercedParams {
  readonly negativePrompt?: string;
  readonly count?: number;
  readonly size?: string;
  readonly aspectRatio?: string;
  readonly quality?: string;
  readonly style?: string;
  readonly seed?: string;
  readonly referenceImages?: readonly string[];
  readonly mask?: string;
  readonly responseFormat?: string;
  readonly timeoutMs?: number;
  readonly providerOptions: NimiJsonObject;
}

export interface NimiVideoGenerationCoercedParams {
  readonly mode: 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference';
  readonly negativePrompt?: string;
  readonly options: {
    readonly ratio?: string;
    readonly durationSec?: number;
    readonly resolution?: string;
    readonly fps?: number;
    readonly seed?: string;
    readonly cameraFixed?: boolean;
    readonly generateAudio?: boolean;
  };
  readonly timeoutMs?: number;
}

export interface NimiSpeechTranscriptionCoercedParams {
  readonly language?: string;
  readonly responseFormat?: string;
  readonly speakerCount?: number;
  readonly prompt?: string;
  readonly timestamps?: boolean;
  readonly diarization?: boolean;
  readonly timeoutMs?: number;
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalDefaultText(value: unknown, extraSentinels: readonly string[] = []): string | undefined {
  const raw = typeof value === 'number' || typeof value === 'bigint' ? String(value) : optionalText(value);
  const normalized = raw.trim();
  if (!normalized) return undefined;
  const lower = normalized.toLowerCase();
  if (lower === 'default' || lower === 'auto' || extraSentinels.includes(lower)) return undefined;
  return normalized;
}

function booleanParam(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalFiniteNumber(
  capabilityId: NimiRuntimeMediaParamCapabilityId,
  value: unknown,
  fieldName: string,
): number | undefined {
  const raw = typeof value === 'number' ? String(value) : optionalText(value);
  if (!raw || raw.toLowerCase() === 'default' || raw.toLowerCase() === 'auto') return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw mediaParamError(capabilityId, `NimiAIConfig selectedParams.${fieldName} must be a finite number.`);
  }
  return parsed;
}

function optionalPositiveInteger(
  capabilityId: NimiRuntimeMediaParamCapabilityId,
  value: unknown,
  fieldName: string,
): number | undefined {
  const parsed = optionalFiniteNumber(capabilityId, value, fieldName);
  if (parsed === undefined) return undefined;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw mediaParamError(capabilityId, `NimiAIConfig selectedParams.${fieldName} must be a positive integer.`);
  }
  return parsed;
}

function optionalPositiveNumber(
  capabilityId: NimiRuntimeMediaParamCapabilityId,
  value: unknown,
  fieldName: string,
): number | undefined {
  const parsed = optionalFiniteNumber(capabilityId, value, fieldName);
  if (parsed === undefined) return undefined;
  if (parsed <= 0) {
    throw mediaParamError(capabilityId, `NimiAIConfig selectedParams.${fieldName} must be greater than zero.`);
  }
  return parsed;
}

function optionalImageSize(value: unknown): string | undefined {
  const text = optionalDefaultText(value);
  if (!text) return undefined;
  const normalized = text.toLowerCase();
  if (/^\d+x\d+$/u.test(normalized) || /^[234]k$/u.test(normalized)) {
    return normalized;
  }
  throw mediaParamError('image.generate', 'NimiAIConfig selectedParams.size must use WIDTHxHEIGHT, 2k, 3k, or 4k format.');
}

function optionalImageResponseFormat(value: unknown): string | undefined {
  const text = optionalDefaultText(value);
  if (!text) return undefined;
  const normalized = text.toLowerCase();
  if (normalized === 'base64' || normalized === 'b64_json' || normalized === 'url') {
    return normalized;
  }
  throw mediaParamError('image.generate', `NimiAIConfig selectedParams.responseFormat is not supported: ${text}.`);
}

function optionalImageIntegerString(
  value: unknown,
  fieldName: string,
  extraSentinels: readonly string[] = [],
): string | undefined {
  const text = optionalDefaultText(value, extraSentinels);
  if (!text) return undefined;
  if (!/^-?\d+$/u.test(text)) {
    throw mediaParamError('image.generate', `NimiAIConfig selectedParams.${fieldName} must be an integer.`);
  }
  return text;
}

function optionalImageStringList(value: unknown, fieldName: string): readonly string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const out = value.map(optionalText).filter(Boolean);
    if (out.length !== value.length) {
      throw mediaParamError('image.generate', `NimiAIConfig selectedParams.${fieldName} must contain only non-empty strings.`);
    }
    return out;
  }
  const text = optionalDefaultText(value);
  return text ? [text] : undefined;
}

function optionalImageSampler(value: unknown): string | undefined {
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
  throw mediaParamError('image.generate', `NimiAIConfig selectedParams.sampler is not supported: ${text}.`);
}

function optionalImageScheduler(value: unknown): string | undefined {
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
  throw mediaParamError('image.generate', `NimiAIConfig selectedParams.scheduler is not supported: ${text}.`);
}

export function coerceNimiImageGenerationParams(
  params: Readonly<Record<string, unknown>>,
): NimiImageGenerationCoercedParams {
  const size = optionalImageSize(params.size);
  const responseFormat = optionalImageResponseFormat(params.responseFormat ?? params.response_format);
  const seed = optionalImageIntegerString(params.seed, 'seed', ['random']);
  const count = optionalPositiveInteger('image.generate', params.count ?? params.n, 'count');
  const timeoutMs = optionalPositiveInteger('image.generate', params.timeoutMs ?? params.timeout_ms, 'timeoutMs');
  const steps = optionalPositiveInteger('image.generate', params.steps ?? params.step, 'steps');
  const cfgScale = optionalPositiveNumber('image.generate', params.cfgScale ?? params.cfg_scale, 'cfgScale');
  const sampler = optionalImageSampler(params.sampler ?? params.mode ?? params.method);
  const scheduler = optionalImageScheduler(params.scheduler);
  const referenceImages = optionalImageStringList(params.referenceImages ?? params.reference_images, 'referenceImages');

  const providerOptions: Record<string, NimiJsonValue> = {};
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

export function coerceNimiVideoGenerationParams(
  params: Readonly<Record<string, unknown>>,
): NimiVideoGenerationCoercedParams {
  const mode = optionalText(params.mode) || 't2v';
  if (!['t2v', 'i2v-first-frame', 'i2v-first-last', 'i2v-reference'].includes(mode)) {
    throw mediaParamError('video.generate', `NimiAIConfig selectedParams.mode is not supported: ${mode}.`);
  }
  const durationSec = optionalFiniteNumber('video.generate', params.durationSec ?? params.duration_sec, 'durationSec');
  const fps = optionalPositiveInteger('video.generate', params.fps, 'fps');
  const timeoutMs = optionalPositiveInteger('video.generate', params.timeoutMs ?? params.timeout_ms, 'timeoutMs');
  const options: {
    ratio?: string;
    durationSec?: number;
    resolution?: string;
    fps?: number;
    seed?: string;
    cameraFixed?: boolean;
    generateAudio?: boolean;
  } = {};
  const ratio = optionalText(params.ratio);
  const resolution = optionalText(params.resolution);
  const seed = optionalText(params.seed);
  const cameraFixed = booleanParam(params.cameraFixed ?? params.camera_fixed);
  const generateAudio = booleanParam(params.generateAudio ?? params.generate_audio);
  if (ratio) options.ratio = ratio;
  if (durationSec !== undefined) options.durationSec = durationSec;
  if (resolution) options.resolution = resolution;
  if (fps !== undefined) options.fps = fps;
  if (seed) options.seed = seed;
  if (cameraFixed !== undefined) options.cameraFixed = cameraFixed;
  if (generateAudio !== undefined) options.generateAudio = generateAudio;
  return {
    mode: mode as NimiVideoGenerationCoercedParams['mode'],
    negativePrompt: optionalText(params.negativePrompt ?? params.negative_prompt) || undefined,
    options,
    timeoutMs,
  };
}

export function coerceNimiSpeechTranscriptionParams(
  params: Readonly<Record<string, unknown>>,
): NimiSpeechTranscriptionCoercedParams {
  const speakerCount = optionalPositiveInteger('audio.transcribe', params.speakerCount ?? params.speaker_count, 'speakerCount');
  const timeoutMs = optionalPositiveInteger('audio.transcribe', params.timeoutMs ?? params.timeout_ms, 'timeoutMs');
  return {
    language: optionalText(params.language) || undefined,
    responseFormat: optionalText(params.responseFormat ?? params.response_format) || undefined,
    speakerCount,
    prompt: optionalText(params.prompt) || undefined,
    timestamps: booleanParam(params.timestamps),
    diarization: booleanParam(params.diarization),
    timeoutMs,
  };
}

export function mimeTypeForNimiAudioUrl(url: string, contentType?: string | null): string {
  const normalizedContentType = optionalText(contentType).split(';')[0]?.trim();
  if (normalizedContentType) return normalizedContentType;
  const lower = url.toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.flac')) return 'audio/flac';
  return 'audio/wav';
}

export async function audioBytesFromNimiUrl(url: string): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw mediaParamError('audio.transcribe', `audio.transcribe audio fetch failed (${response.status}) for ${url}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw mediaParamError('audio.transcribe', 'audio.transcribe audio fetch returned an empty body.');
  }
  return {
    bytes,
    mimeType: mimeTypeForNimiAudioUrl(url, response.headers.get('content-type')),
  };
}

function mediaParamError(capabilityId: NimiRuntimeMediaParamCapabilityId, message: string): Error {
  return createNimiError({
    message,
    code: 'SDK_GENERATION_MEDIA_PARAM_INVALID',
    reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
    actionHint: `fix_${capabilityId.replace('.', '_')}_selected_params`,
    source: 'sdk',
  });
}

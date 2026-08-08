import type { NimiJsonObject } from '@nimiplatform/kit/core/sdk-contract';

export type CapabilityDefaultField = {
  readonly key: string;
  readonly aliases?: readonly string[];
  readonly kind: 'number' | 'integer' | 'string' | 'boolean' | 'string-list' | 'object';
  readonly fields?: readonly CapabilityDefaultField[];
};

const number = (key: string, aliases?: readonly string[]): CapabilityDefaultField => ({ key, aliases, kind: 'number' });
const integer = (key: string, aliases?: readonly string[]): CapabilityDefaultField => ({ key, aliases, kind: 'integer' });
const string = (key: string, aliases?: readonly string[]): CapabilityDefaultField => ({ key, aliases, kind: 'string' });
const boolean = (key: string, aliases?: readonly string[]): CapabilityDefaultField => ({ key, aliases, kind: 'boolean' });
const stringList = (key: string, aliases?: readonly string[]): CapabilityDefaultField => ({ key, aliases, kind: 'string-list' });
const object = (
  key: string,
  fields: readonly CapabilityDefaultField[],
  aliases?: readonly string[],
): CapabilityDefaultField => ({ key, aliases, kind: 'object', fields });

/** Runtime AIConfig defaults allowlist projected as typed fields. */
export const CAPABILITY_DEFAULT_FIELDS: Readonly<Record<string, readonly CapabilityDefaultField[]>> = Object.freeze({
  'text.generate': Object.freeze([
    number('temperature'),
    number('topP', ['top_p']),
    integer('topK', ['top_k']),
    integer('maxTokens', ['max_tokens']),
    number('presencePenalty', ['presence_penalty']),
    number('frequencyPenalty', ['frequency_penalty']),
    integer('seed'),
    stringList('stop'),
  ]),
  'image.generate': Object.freeze([
    string('negative_prompt', ['negativePrompt']),
    integer('n'),
    string('size'),
    string('aspect_ratio', ['aspectRatio']),
    string('quality'),
    string('style'),
    integer('seed'),
    string('response_format', ['responseFormat']),
  ]),
  'video.generate': Object.freeze([
    string('negative_prompt', ['negativePrompt']),
    object('options', Object.freeze([
      string('resolution'),
      string('ratio'),
      integer('durationSec', ['duration_sec']),
      integer('frames'),
      integer('fps'),
      integer('seed'),
      boolean('cameraFixed', ['camera_fixed']),
      boolean('watermark'),
      boolean('generateAudio', ['generate_audio']),
      boolean('draft'),
      string('serviceTier', ['service_tier']),
      integer('executionExpiresAfterSec', ['execution_expires_after_sec']),
      boolean('returnLastFrame', ['return_last_frame']),
    ])),
  ]),
  'audio.synthesize': Object.freeze([
    string('language'),
    string('audio_format', ['audioFormat']),
    integer('sample_rate_hz', ['sampleRateHz']),
    number('speed'),
    number('pitch'),
    number('volume'),
    string('emotion'),
    string('timing_mode', ['timingMode']),
    object('voice_render_hints', Object.freeze([
      number('stability'),
      number('similarity_boost', ['similarityBoost']),
      number('style'),
      boolean('use_speaker_boost', ['useSpeakerBoost']),
      number('speed'),
    ]), ['voiceRenderHints']),
  ]),
  'audio.transcribe': Object.freeze([
    string('mime_type', ['mimeType']),
    string('language'),
    boolean('timestamps'),
    boolean('diarization'),
    integer('speaker_count', ['speakerCount']),
    string('prompt'),
    string('response_format', ['responseFormat']),
  ]),
});

function recordValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function fieldValue(source: Readonly<Record<string, unknown>>, field: CapabilityDefaultField): unknown {
  if (Object.hasOwn(source, field.key)) return source[field.key];
  for (const alias of field.aliases || []) {
    if (Object.hasOwn(source, alias)) return source[alias];
  }
  return undefined;
}

function sanitizeFields(
  source: Readonly<Record<string, unknown>>,
  fields: readonly CapabilityDefaultField[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const value = fieldValue(source, field);
    if (field.kind === 'object') {
      const nestedSource = recordValue(value);
      if (!nestedSource) continue;
      const nested = sanitizeFields(nestedSource, field.fields || []);
      if (Object.keys(nested).length > 0) result[field.key] = nested;
      continue;
    }
    if (field.kind === 'boolean') {
      if (typeof value === 'boolean') result[field.key] = value;
      continue;
    }
    if (field.kind === 'number' || field.kind === 'integer') {
      if (typeof value === 'number' && Number.isFinite(value) && (
        field.kind !== 'integer' || Number.isInteger(value)
      )) result[field.key] = value;
      continue;
    }
    if (field.kind === 'string') {
      if (typeof value === 'string' && value.trim()) result[field.key] = value.trim();
      continue;
    }
    if (Array.isArray(value)) {
      const entries = value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (entries.length > 0) result[field.key] = entries;
    }
  }
  return result;
}

export function capabilityDefaultFields(
  capabilityContract: string,
): readonly CapabilityDefaultField[] | null {
  return CAPABILITY_DEFAULT_FIELDS[capabilityContract] || null;
}

export function sanitizeCapabilityDefaults(
  capabilityContract: string,
  source: NimiJsonObject | undefined,
): NimiJsonObject {
  const fields = capabilityDefaultFields(capabilityContract);
  if (!fields) return {};
  return sanitizeFields(recordValue(source) || {}, fields) as NimiJsonObject;
}

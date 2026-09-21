import { createNimiError } from '../../types';

export type NimiMusicGenerationInputProfile = {
  readonly lyricsMode: 'unsupported' | 'optional' | 'required';
  readonly scoreMode: 'unsupported' | 'required';
  readonly scoreFormats: readonly ('abc' | 'midi')[];
  readonly scoreConditioning: readonly ('melody-only' | 'melody-and-harmony')[];
  readonly supportsInstrumental: boolean;
  readonly supportsSeed: boolean;
  readonly supportsGeneratedScore: boolean;
  readonly supportsAudioReference: boolean;
  readonly maxDurationSeconds: number;
  readonly defaultDurationSeconds: number;
  readonly maxPromptBytes: number;
  readonly maxLyricsBytes: number;
  readonly maxScoreBytes: number;
  readonly maxAudioReferenceBytes: number;
};
export type NimiMusicTranscriptionInputProfile = {
  readonly formats: readonly ('abc' | 'midi' | 'timeline')[];
  readonly parts: readonly ('vocal-melody' | 'lead-sheet' | 'full-arrangement')[];
  readonly maxDurationSeconds: number;
  readonly maxSourceBytes: number;
  readonly supportsRange: boolean;
};
export type NimiMusicInputCapabilities = {
  readonly generation: readonly NimiMusicGenerationInputProfile[];
  readonly transcription?: readonly NimiMusicTranscriptionInputProfile[];
};

const fail = (): never => { throw createNimiError({ reasonCode: 'SDK_LOCAL_APP_PROJECTION_INVALID', message: 'Music input capabilities are invalid.', actionHint: 'update_matching_runtime_sdk_kit', source: 'sdk' }); };
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  return value as Record<string, unknown>;
};
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const tokens = (value: unknown, allowed: readonly string[]): value is string[] => Array.isArray(value) && value.length <= allowed.length && new Set(value).size === value.length && value.every((item) => typeof item === 'string' && allowed.includes(item));

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
export function projectMusicInputCapabilities(value: unknown): NimiMusicInputCapabilities {
  const source = record(value);
  if (Object.keys(source).some(key => !['generation', 'transcription'].includes(key)) || !Array.isArray(source.generation) || source.generation.length > 16
    || (source.transcription !== undefined && (!Array.isArray(source.transcription) || source.transcription.length > 16))) fail();
  const generation = (source.generation as unknown[]).map((entry) => {
    const row = record(entry);
    const keys = ['lyricsMode', 'scoreMode', 'scoreFormats', 'scoreConditioning', 'supportsInstrumental', 'supportsSeed', 'supportsGeneratedScore', 'supportsAudioReference', 'maxDurationSeconds', 'defaultDurationSeconds', 'maxPromptBytes', 'maxLyricsBytes', 'maxScoreBytes', 'maxAudioReferenceBytes'];
    if (Object.keys(row).length !== keys.length || Object.keys(row).some((key) => !keys.includes(key))
      || !['unsupported', 'optional', 'required'].includes(String(row.lyricsMode)) || !['unsupported', 'required'].includes(String(row.scoreMode))
      || !tokens(row.scoreFormats, ['abc', 'midi']) || !tokens(row.scoreConditioning, ['melody-only', 'melody-and-harmony'])
      || ['supportsInstrumental', 'supportsSeed', 'supportsGeneratedScore', 'supportsAudioReference'].some((key) => typeof row[key] !== 'boolean')
      || !integer(row.maxDurationSeconds, 1, 600) || !integer(row.defaultDurationSeconds, 1, Number(row.maxDurationSeconds))
      || !integer(row.maxPromptBytes, 1, 32768) || !integer(row.maxLyricsBytes, 0, 32768)
      || !integer(row.maxScoreBytes, 0, 1048576) || !integer(row.maxAudioReferenceBytes, 0, 33554432)) fail();
    const profile = row as unknown as NimiMusicGenerationInputProfile;
    if ((profile.scoreMode === 'required') !== (profile.scoreFormats.length > 0 && profile.scoreConditioning.length > 0 && profile.maxScoreBytes > 0)
      || (profile.scoreMode === 'unsupported' && (profile.scoreFormats.length || profile.scoreConditioning.length || profile.maxScoreBytes))
      || profile.supportsAudioReference !== (profile.maxAudioReferenceBytes > 0)
      || (profile.lyricsMode === 'unsupported') !== (profile.maxLyricsBytes === 0)
      || (profile.lyricsMode === 'required' && profile.supportsInstrumental)) fail();
    return Object.freeze({ ...profile, scoreFormats: Object.freeze([...profile.scoreFormats]), scoreConditioning: Object.freeze([...profile.scoreConditioning]) });
  });
  const transcription = ((source.transcription ?? []) as unknown[]).map(entry => {
    const row = record(entry); const keys = ['formats', 'parts', 'maxDurationSeconds', 'maxSourceBytes', 'supportsRange'];
    if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))
      || !tokens(row.formats, ['abc', 'midi', 'timeline']) || !row.formats.length
      || !tokens(row.parts, ['vocal-melody', 'lead-sheet', 'full-arrangement']) || !row.parts.length
      || !integer(row.maxDurationSeconds, 1, 600) || !integer(row.maxSourceBytes, 1, 512 * 1024 * 1024) || typeof row.supportsRange !== 'boolean') fail();
    const profile = row as unknown as NimiMusicTranscriptionInputProfile;
    return Object.freeze({ ...profile, formats: Object.freeze([...profile.formats]), parts: Object.freeze([...profile.parts]) });
  });
  if (!generation.length && !transcription.length) fail();
  return Object.freeze({ generation: Object.freeze(generation), ...(transcription.length ? { transcription: Object.freeze(transcription) } : {}) });
}

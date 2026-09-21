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
export type NimiMusicInputCapabilities = { readonly generation: readonly NimiMusicGenerationInputProfile[] };

const fail = (): never => { throw createNimiError({ reasonCode: 'SDK_LOCAL_APP_PROJECTION_INVALID', message: 'Music input capabilities are invalid.', actionHint: 'update_matching_runtime_sdk_kit', source: 'sdk' }); };
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
};
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const tokens = (value: unknown, allowed: readonly string[]): value is string[] => Array.isArray(value) && value.length <= allowed.length && new Set(value).size === value.length && value.every((item) => typeof item === 'string' && allowed.includes(item));

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
export function projectMusicInputCapabilities(value: unknown): NimiMusicInputCapabilities {
  const source = record(value);
  if (Object.keys(source).join('|') !== 'generation' || !Array.isArray(source.generation) || source.generation.length < 1 || source.generation.length > 16) fail();
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
  return Object.freeze({ generation: Object.freeze(generation) });
}

import {
  asRecord, assertExactKeys, assertExactProjectionKeys, localAppError, localAppProjectionError,
} from './local-app-runtime-platform-validation.js';
import {
  MusicGenerationTermination, MusicScoreConditioning, MusicScoreFormat, MusicScoreOrigin,
  type MusicGeneration, type MusicGenerateScenarioSpec,
} from '../../core-generated/runtime-typed-client.js';

export type NimiLocalAppMusicGenerateSpec = {
  readonly type: 'music-generate';
  readonly prompt: string;
  readonly lyrics: string;
  /** Requested budget, not a guarantee of a complete composition. Exact implementations may support less. */
  readonly durationSeconds?: number;
  readonly instrumental?: boolean;
  readonly seed?: number;
  readonly score?: { readonly artifactId: string; readonly format: 'abc' | 'midi' };
  readonly scoreConditioning?: 'melody-only' | 'melody-and-harmony';
  readonly returnGeneratedScore?: boolean;
  readonly audioReference?: {
    readonly artifactId: string;
    readonly range?: { readonly startFrame: number; readonly endFrame: number };
  };
};

export type NimiLocalAppMusicGeneration = {
  readonly mixArtifactId: string;
  readonly generatedScore?: {
    readonly artifactId: string;
    readonly format: 'abc' | 'midi';
    readonly origin: 'generated-plan' | 'transcribed-estimate';
    readonly truncated: boolean;
  };
  readonly actualSeed?: number;
  readonly termination: 'unknown' | 'model-end' | 'budget-limit';
  readonly audioInfo: {
    readonly sampleRateHz: number;
    readonly channels: number;
    readonly frameCount: number;
    readonly durationMs: number;
  };
};

const inputError = (): never => localAppError('Invalid music generation input', 'SDK_LOCAL_APP_INPUT_INVALID', 'fix_input');
const uint = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const content = (value: unknown): value is string => typeof value === 'string' && new TextEncoder().encode(value).length <= 32768 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uD800-\uDFFF]/u.test(value);

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
export function validateNimiLocalAppMusicGenerateSpec(value: unknown): NimiLocalAppMusicGenerateSpec {
  const record = asRecord(value);
  assertExactKeys(record, ['type', 'prompt', 'lyrics', 'durationSeconds', 'instrumental', 'seed', 'score', 'scoreConditioning', 'returnGeneratedScore', 'audioReference'], 'music spec');
  if (!record || record.type !== 'music-generate' || !content(record.prompt) || !record.prompt.trim() || !content(record.lyrics)) inputError();
  if (record.durationSeconds !== undefined && !uint(record.durationSeconds, 1, 600)) inputError();
  for (const key of ['instrumental', 'returnGeneratedScore']) if (record[key] !== undefined && typeof record[key] !== 'boolean') inputError();
  if (record.instrumental && (record.lyrics as string).trim()) inputError();
  if (record.seed !== undefined && !uint(record.seed, 0, 0xffffffff)) inputError();
  if (record.score !== undefined) {
    const score = asRecord(record.score);
    assertExactKeys(score, ['artifactId', 'format'], 'music score');
    if (!score || !identifier(score.artifactId) || !['abc', 'midi'].includes(String(score.format)) || !['melody-only', 'melody-and-harmony'].includes(String(record.scoreConditioning))) inputError();
  } else if (record.scoreConditioning !== undefined) inputError();
  if (record.audioReference !== undefined) {
    const reference = asRecord(record.audioReference);
    assertExactKeys(reference, ['artifactId', 'range'], 'music audio reference');
    if (!reference || !identifier(reference.artifactId)) inputError();
    if (reference.range !== undefined) {
      const range = asRecord(reference.range);
      assertExactKeys(range, ['startFrame', 'endFrame'], 'audio frame range');
      if (!range || !uint(range.startFrame, 0, 57600000) || !uint(range.endFrame, 1, 57600000) || range.startFrame >= range.endFrame) inputError();
    }
  }
  return value as NimiLocalAppMusicGenerateSpec;
}

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
export function validateNimiLocalAppMusicGeneration(value: unknown, artifactsValue: unknown): NimiLocalAppMusicGeneration {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['mixArtifactId', 'termination', 'audioInfo',
    ...(record && Object.hasOwn(record, 'generatedScore') ? ['generatedScore'] : []),
    ...(record && Object.hasOwn(record, 'actualSeed') ? ['actualSeed'] : [])], 'music generation');
  if (!record || !identifier(record.mixArtifactId) || !['unknown', 'model-end', 'budget-limit'].includes(String(record.termination))
    || (record.actualSeed !== undefined && !uint(record.actualSeed, 0, 0xffffffff))) localAppProjectionError('music generation');
  const info = asRecord(record.audioInfo);
  assertExactProjectionKeys(info, ['sampleRateHz', 'channels', 'frameCount', 'durationMs'], 'music audio facts');
  if (!info || !uint(info.sampleRateHz, 8000, 96000) || !uint(info.channels, 1, 2) || !uint(info.frameCount, 1, info.sampleRateHz * 600)
    || info.durationMs !== Math.floor(info.frameCount * 1000 / info.sampleRateHz)) localAppProjectionError('music audio facts');
  if (!Array.isArray(artifactsValue) || artifactsValue.length !== (record.generatedScore ? 2 : 1)) localAppProjectionError('music artifact set');
  const artifacts = artifactsValue.map(asRecord);
  const mix = artifacts.find((artifact) => artifact?.artifactId === record.mixArtifactId);
  if (!mix || mix.mimeType !== 'audio/wav' || mix.sampleRateHz !== info.sampleRateHz || mix.channels !== info.channels || mix.frameCount !== info.frameCount
    || mix.durationMs !== info.durationMs || !uint(mix.sizeBytes, info.frameCount * info.channels * 4 + 56, 512 * 1024 * 1024)) localAppProjectionError('music mix facts');
  if (record.generatedScore !== undefined) {
    const score = asRecord(record.generatedScore);
    assertExactProjectionKeys(score, ['artifactId', 'format', 'origin', 'truncated'], 'generated score');
    if (!score || !identifier(score.artifactId) || score.artifactId === record.mixArtifactId || score.format !== 'abc'
      || score.origin !== 'generated-plan' || typeof score.truncated !== 'boolean') localAppProjectionError('generated score');
    const artifact = artifacts.find((entry) => entry?.artifactId === score.artifactId);
    if (!artifact || artifact.mimeType !== 'text/vnd.abc' || !uint(artifact.sizeBytes, 1, 1048576)) localAppProjectionError('generated score artifact');
  }
  return Object.freeze(value as NimiLocalAppMusicGeneration);
}

export function runtimeMusicGenerateSpec(spec: NimiLocalAppMusicGenerateSpec): MusicGenerateScenarioSpec {
  return {
    prompt: spec.prompt, lyrics: spec.lyrics, durationSeconds: spec.durationSeconds ?? 0,
    instrumental: spec.instrumental ?? false, seed: spec.seed, negativePrompt: '', style: '', title: '',
    returnGeneratedScore: spec.returnGeneratedScore ?? false,
    score: spec.score ? { artifactId: spec.score.artifactId, format: spec.score.format === 'abc' ? MusicScoreFormat.ABC : MusicScoreFormat.MIDI } : undefined,
    scoreConditioning: spec.scoreConditioning === 'melody-only' ? MusicScoreConditioning.MELODY_ONLY : spec.scoreConditioning === 'melody-and-harmony' ? MusicScoreConditioning.MELODY_AND_HARMONY : MusicScoreConditioning.UNSPECIFIED,
    audioReference: spec.audioReference ? { artifactId: spec.audioReference.artifactId, range: spec.audioReference.range ? { startFrame: String(spec.audioReference.range.startFrame), endFrame: String(spec.audioReference.range.endFrame) } : undefined } : undefined,
  };
}

export function localMusicGenerateSpec(spec: MusicGenerateScenarioSpec): NimiLocalAppMusicGenerateSpec {
  if (spec.negativePrompt || spec.style || spec.title) inputError();
  const format = spec.score?.format === MusicScoreFormat.ABC ? 'abc' : spec.score?.format === MusicScoreFormat.MIDI ? 'midi' : undefined;
  const conditioning = spec.scoreConditioning === MusicScoreConditioning.MELODY_ONLY ? 'melody-only' : spec.scoreConditioning === MusicScoreConditioning.MELODY_AND_HARMONY ? 'melody-and-harmony' : undefined;
  if ((spec.score && !format) || (!conditioning && spec.scoreConditioning !== MusicScoreConditioning.UNSPECIFIED)) inputError();
  return validateNimiLocalAppMusicGenerateSpec({
    type: 'music-generate', prompt: spec.prompt, lyrics: spec.lyrics,
    ...(spec.durationSeconds ? { durationSeconds: spec.durationSeconds } : {}), instrumental: spec.instrumental,
    ...(spec.seed !== undefined ? { seed: spec.seed } : {}), returnGeneratedScore: spec.returnGeneratedScore,
    ...(spec.score ? { score: { artifactId: spec.score.artifactId, format } } : {}),
    ...(conditioning ? { scoreConditioning: conditioning } : {}),
    ...(spec.audioReference ? { audioReference: { artifactId: spec.audioReference.artifactId,
      ...(spec.audioReference.range ? { range: { startFrame: Number(spec.audioReference.range.startFrame), endFrame: Number(spec.audioReference.range.endFrame) } } : {}) } } : {}),
  });
}

export function localMusicGeneration(value: MusicGeneration): unknown {
  return {
    mixArtifactId: value.mixArtifactId,
    termination: ({ [MusicGenerationTermination.UNKNOWN]: 'unknown', [MusicGenerationTermination.MODEL_END]: 'model-end', [MusicGenerationTermination.BUDGET_LIMIT]: 'budget-limit' } as Record<number, string>)[value.termination],
    ...(value.actualSeed !== undefined ? { actualSeed: value.actualSeed } : {}),
    audioInfo: value.audioInfo ? { ...value.audioInfo, frameCount: Number(value.audioInfo.frameCount), durationMs: Number(value.audioInfo.durationMs) } : undefined,
    ...(value.generatedScore ? { generatedScore: { artifactId: value.generatedScore.artifactId, truncated: value.generatedScore.truncated,
      format: value.generatedScore.format === MusicScoreFormat.ABC ? 'abc' : value.generatedScore.format === MusicScoreFormat.MIDI ? 'midi' : undefined,
      origin: value.generatedScore.origin === MusicScoreOrigin.GENERATED_PLAN ? 'generated-plan' : value.generatedScore.origin === MusicScoreOrigin.TRANSCRIBED_ESTIMATE ? 'transcribed-estimate' : undefined } } : {}),
  };
}

export function runtimeMusicGeneration(value: NimiLocalAppMusicGeneration | undefined): MusicGeneration | undefined {
  if (!value) return undefined;
  return {
    mixArtifactId: value.mixArtifactId, actualSeed: value.actualSeed,
    termination: { unknown: MusicGenerationTermination.UNKNOWN, 'model-end': MusicGenerationTermination.MODEL_END, 'budget-limit': MusicGenerationTermination.BUDGET_LIMIT }[value.termination],
    audioInfo: { ...value.audioInfo, frameCount: String(value.audioInfo.frameCount), durationMs: String(value.audioInfo.durationMs) },
    generatedScore: value.generatedScore ? { ...value.generatedScore,
      format: value.generatedScore.format === 'abc' ? MusicScoreFormat.ABC : MusicScoreFormat.MIDI,
      origin: value.generatedScore.origin === 'generated-plan' ? MusicScoreOrigin.GENERATED_PLAN : MusicScoreOrigin.TRANSCRIBED_ESTIMATE } : undefined,
  };
}

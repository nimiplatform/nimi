import { asRecord, assertExactKeys, assertExactProjectionKeys, localAppError, localAppProjectionError } from './local-app-runtime-platform-validation.js';
import { MusicScoreFormat, MusicScoreOrigin, MusicTranscriptionCompleteness, MusicTranscriptionFormat, MusicTranscriptionPart,
  type MusicTranscribeScenarioSpec, type MusicTranscription } from '../../core-generated/runtime-typed-client.js';

export type NimiMusicTranscriptionFormat = 'abc' | 'midi' | 'timeline';
export type NimiMusicTranscriptionPart = 'vocal-melody' | 'lead-sheet' | 'full-arrangement';
export type NimiLocalAppMusicTranscribeSpec = {
  readonly type: 'music-transcribe';
  readonly sourceAudio: { readonly artifactId: string; readonly range?: { readonly startFrame: number; readonly endFrame: number } };
  readonly requestedFormats: readonly NimiMusicTranscriptionFormat[];
  readonly requestedParts: readonly NimiMusicTranscriptionPart[];
};
export type NimiLocalAppMusicTranscription = {
  readonly scores: readonly { readonly artifactId: string; readonly format: 'abc' | 'midi'; readonly part: NimiMusicTranscriptionPart }[];
  readonly timelineArtifactId?: string;
  readonly origin: 'transcribed-estimate';
  readonly sourceArtifactId: string;
  readonly sourceInfo: { readonly sampleRateHz: number; readonly channels: number; readonly frameCount: number; readonly durationMs: number };
  readonly inputRange: { readonly startFrame: number; readonly endFrame: number };
  readonly completeness: 'unknown' | 'complete' | 'truncated';
};
const formats = { abc: MusicTranscriptionFormat.ABC, midi: MusicTranscriptionFormat.MIDI, timeline: MusicTranscriptionFormat.TIMELINE } as const;
const parts = { 'vocal-melody': MusicTranscriptionPart.VOCAL_MELODY, 'lead-sheet': MusicTranscriptionPart.LEAD_SHEET, 'full-arrangement': MusicTranscriptionPart.FULL_ARRANGEMENT } as const;
const completeness = { unknown: MusicTranscriptionCompleteness.UNKNOWN, complete: MusicTranscriptionCompleteness.COMPLETE, truncated: MusicTranscriptionCompleteness.TRUNCATED } as const;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(value);
const uint = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const set = (value: unknown, allowed: readonly string[]): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= allowed.length && new Set(value).size === value.length && value.every(v => typeof v === 'string' && allowed.includes(v));
const inputError = (): never => localAppError('Invalid music transcription input', 'SDK_LOCAL_APP_INPUT_INVALID', 'fix_input');
const fromEnum = <T extends string>(entries: Record<T, number>, value: number): T | undefined => (Object.keys(entries) as T[]).find(key => entries[key] === value);

// @nimi-authority: rule.nimi.runtime.ai-provider.music-transcription
export function validateNimiLocalAppMusicTranscribeSpec(value: unknown): NimiLocalAppMusicTranscribeSpec {
  const record = asRecord(value); assertExactKeys(record, ['type', 'sourceAudio', 'requestedFormats', 'requestedParts'], 'music transcription spec');
  if (!record || record.type !== 'music-transcribe' || !set(record.requestedFormats, Object.keys(formats)) || !set(record.requestedParts, Object.keys(parts))) inputError();
  const source = asRecord(record.sourceAudio); assertExactKeys(source, ['artifactId', 'range'], 'music transcription source');
  if (!source || !identifier(source.artifactId)) inputError();
  if (source.range !== undefined) {
    const range = asRecord(source.range); assertExactKeys(range, ['startFrame', 'endFrame'], 'music transcription range');
    if (!range || !uint(range.startFrame, 0, 57600000) || !uint(range.endFrame, 1, 57600000) || range.startFrame >= range.endFrame) inputError();
  }
  return value as NimiLocalAppMusicTranscribeSpec;
}

export function validateNimiLocalAppMusicTranscription(value: unknown, artifactValues: unknown): NimiLocalAppMusicTranscription {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['scores', 'origin', 'sourceArtifactId', 'sourceInfo', 'inputRange', 'completeness', ...(record && Object.hasOwn(record, 'timelineArtifactId') ? ['timelineArtifactId'] : [])], 'music transcription');
  if (!record || record.origin !== 'transcribed-estimate' || !identifier(record.sourceArtifactId) || !Object.hasOwn(completeness, String(record.completeness)) || !Array.isArray(record.scores) || record.scores.length > 6 || !Array.isArray(artifactValues)) localAppProjectionError('music transcription');
  const info = asRecord(record.sourceInfo); assertExactProjectionKeys(info, ['sampleRateHz', 'channels', 'frameCount', 'durationMs'], 'transcription source facts');
  if (!info || !uint(info.sampleRateHz, 8000, 96000) || !uint(info.channels, 1, 2) || !uint(info.frameCount, 1, info.sampleRateHz * 600) || info.durationMs !== Math.floor(info.frameCount * 1000 / info.sampleRateHz)) localAppProjectionError('transcription source facts');
  const range = asRecord(record.inputRange); assertExactProjectionKeys(range, ['startFrame', 'endFrame'], 'transcription input range');
  if (!range || !uint(range.startFrame, 0, info.frameCount - 1) || !uint(range.endFrame, 1, info.frameCount) || range.endFrame <= range.startFrame) localAppProjectionError('transcription input range');
  const expected = new Map<string, { mime: string; max: number }>(); const pairs = new Set<string>();
  for (const candidate of record.scores) {
    const score = asRecord(candidate); assertExactProjectionKeys(score, ['artifactId', 'format', 'part'], 'transcribed score');
    if (!score || !identifier(score.artifactId) || !['abc', 'midi'].includes(String(score.format)) || !Object.hasOwn(parts, String(score.part)) || expected.has(score.artifactId)) localAppProjectionError('transcribed score');
    const pair = score.format + ':' + score.part; if (pairs.has(pair)) localAppProjectionError('duplicate transcribed score'); pairs.add(pair);
    expected.set(score.artifactId, { mime: score.format === 'abc' ? 'text/vnd.abc' : 'audio/midi', max: score.format === 'abc' ? 1048576 : 16777216 });
  }
  if (record.timelineArtifactId !== undefined) {
    if (!identifier(record.timelineArtifactId) || expected.has(record.timelineArtifactId)) localAppProjectionError('music timeline reference');
    expected.set(record.timelineArtifactId, { mime: 'application/vnd.nimi.music-timeline+json', max: 16777216 });
  }
  if (!expected.size || expected.size !== artifactValues.length) localAppProjectionError('music transcription artifact set');
  for (const candidate of artifactValues) {
    const artifact = asRecord(candidate); const match = artifact && expected.get(String(artifact.artifactId));
    if (!artifact || !match || artifact.mimeType !== match.mime || !uint(artifact.sizeBytes, 1, match.max)) localAppProjectionError('music transcription artifact');
    expected.delete(String(artifact.artifactId));
  }
  return Object.freeze(value as NimiLocalAppMusicTranscription);
}

export function runtimeMusicTranscribeSpec(value: NimiLocalAppMusicTranscribeSpec): MusicTranscribeScenarioSpec {
  return { sourceAudio: { artifactId: value.sourceAudio.artifactId, range: value.sourceAudio.range ? { startFrame: String(value.sourceAudio.range.startFrame), endFrame: String(value.sourceAudio.range.endFrame) } : undefined },
    requestedFormats: value.requestedFormats.map(v => formats[v]), requestedParts: value.requestedParts.map(v => parts[v]) };
}
export function localMusicTranscribeSpec(value: MusicTranscribeScenarioSpec): NimiLocalAppMusicTranscribeSpec {
  return validateNimiLocalAppMusicTranscribeSpec({ type: 'music-transcribe', sourceAudio: { artifactId: value.sourceAudio?.artifactId,
    ...(value.sourceAudio?.range ? { range: { startFrame: Number(value.sourceAudio.range.startFrame), endFrame: Number(value.sourceAudio.range.endFrame) } } : {}) },
    requestedFormats: value.requestedFormats.map(v => fromEnum(formats, v)), requestedParts: value.requestedParts.map(v => fromEnum(parts, v)) });
}
export function localMusicTranscription(value: MusicTranscription): unknown {
  return { scores: value.scores.map(score => ({ artifactId: score.artifactId, format: score.format === MusicScoreFormat.ABC ? 'abc' : score.format === MusicScoreFormat.MIDI ? 'midi' : undefined, part: fromEnum(parts, score.part) })),
    ...(value.timelineArtifactId ? { timelineArtifactId: value.timelineArtifactId } : {}), origin: value.origin === MusicScoreOrigin.TRANSCRIBED_ESTIMATE ? 'transcribed-estimate' : undefined,
    sourceArtifactId: value.sourceArtifactId, sourceInfo: value.sourceInfo ? { ...value.sourceInfo, frameCount: Number(value.sourceInfo.frameCount), durationMs: Number(value.sourceInfo.durationMs) } : undefined,
    inputRange: value.inputRange ? { startFrame: Number(value.inputRange.startFrame), endFrame: Number(value.inputRange.endFrame) } : undefined, completeness: fromEnum(completeness, value.completeness) };
}
export function runtimeMusicTranscription(value: NimiLocalAppMusicTranscription | undefined): MusicTranscription | undefined {
  if (!value) return undefined;
  return { scores: value.scores.map(score => ({ artifactId: score.artifactId, format: score.format === 'abc' ? MusicScoreFormat.ABC : MusicScoreFormat.MIDI, part: parts[score.part] })),
    timelineArtifactId: value.timelineArtifactId ?? '', origin: MusicScoreOrigin.TRANSCRIBED_ESTIMATE, sourceArtifactId: value.sourceArtifactId,
    sourceInfo: { ...value.sourceInfo, frameCount: String(value.sourceInfo.frameCount), durationMs: String(value.sourceInfo.durationMs) },
    inputRange: { startFrame: String(value.inputRange.startFrame), endFrame: String(value.inputRange.endFrame) }, completeness: completeness[value.completeness] };
}

import { asRecord, assertExactKeys, assertExactProjectionKeys, localAppError, localAppProjectionError } from './local-app-runtime-platform-validation.js';
import { VoiceConversionLengthRelation, VoiceConvertSourceKind,
  type AudioVoiceConvertScenarioSpec, type VoiceConversion, type VoiceConvertTargetVoice } from '../../core-generated/runtime-typed-client.js';

export type NimiVoiceConvertSourceKind = 'singing';
export type NimiVoiceConvertTargetKind = 'reference-audio' | 'preset' | 'voice-asset';
export type NimiVoiceConversionLengthRelation = 'EXACT' | 'MODEL_FRAME_ROUNDING';
export type NimiLocalAppVoiceConvertSource = { readonly artifactId: string; readonly range?: { readonly startFrame: number; readonly endFrame: number } };
export type NimiLocalAppVoiceConvertTargetVoice =
  | { readonly kind: 'reference-audio'; readonly artifactId: string; readonly range?: { readonly startFrame: number; readonly endFrame: number } }
  | { readonly kind: 'preset'; readonly presetVoiceId: string }
  | { readonly kind: 'voice-asset'; readonly voiceAssetId: string };
export type NimiLocalAppVoiceConvertSpec = {
  readonly type: 'audio-voice-convert';
  readonly sourceVocal: NimiLocalAppVoiceConvertSource;
  readonly sourceKind: NimiVoiceConvertSourceKind;
  readonly targetVoice: NimiLocalAppVoiceConvertTargetVoice;
  readonly semitoneShift?: number;
};
export type NimiLocalAppVoiceConversion = {
  readonly vocalArtifactId: string;
  readonly sourceArtifactId: string;
  readonly sourceInfo: { readonly sampleRateHz: number; readonly channels: number; readonly frameCount: number; readonly durationMs: number };
  readonly inputRange: { readonly startFrame: number; readonly endFrame: number };
  readonly vocalInfo: { readonly sampleRateHz: number; readonly channels: number; readonly frameCount: number; readonly durationMs: number };
  readonly lengthRelation: NimiVoiceConversionLengthRelation;
  readonly durationDeltaMs: number;
};
const sourceKinds = { singing: VoiceConvertSourceKind.SINGING } as const;
const lengths = { EXACT: VoiceConversionLengthRelation.EXACT, MODEL_FRAME_ROUNDING: VoiceConversionLengthRelation.MODEL_FRAME_ROUNDING } as const;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(value);
const uint = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const inputError = (): never => localAppError('Invalid voice conversion input', 'SDK_LOCAL_APP_INPUT_INVALID', 'fix_input');
const fromEnum = <T extends string>(entries: Record<T, number>, value: number): T | undefined => (Object.keys(entries) as T[]).find(key => entries[key] === value);

function audioFacts(value: unknown, field: string) {
  const info = asRecord(value); assertExactProjectionKeys(info, ['sampleRateHz', 'channels', 'frameCount', 'durationMs'], field);
  if (!info || !uint(info.sampleRateHz, 8000, 96000) || !uint(info.channels, 1, 2) || !uint(info.frameCount, 1, info.sampleRateHz * 600)
    || info.durationMs !== Math.floor(info.frameCount * 1000 / info.sampleRateHz)) localAppProjectionError(field);
  return { sampleRateHz: info.sampleRateHz, channels: info.channels, frameCount: info.frameCount, durationMs: info.durationMs };
}

function musicAudio(value: unknown, field: string): NimiLocalAppVoiceConvertSource {
  const source = asRecord(value); assertExactKeys(source, ['artifactId', 'range'], field);
  if (!source || !identifier(source.artifactId)) inputError();
  if (source.range !== undefined) {
    const range = asRecord(source.range); assertExactKeys(range, ['startFrame', 'endFrame'], field);
    if (!range || !uint(range.startFrame, 0, 57600000) || !uint(range.endFrame, 1, 57600000) || range.startFrame >= range.endFrame) inputError();
  }
  return value as NimiLocalAppVoiceConvertSource;
}

function musicAudioInput(value: NimiLocalAppVoiceConvertSource) {
  return { artifactId: value.artifactId, range: value.range ? { startFrame: String(value.range.startFrame), endFrame: String(value.range.endFrame) } : undefined };
}

function localMusicAudio(value: { readonly artifactId?: string; readonly range?: { readonly startFrame: string; readonly endFrame: string } }): NimiLocalAppVoiceConvertSource {
  return { artifactId: value.artifactId ?? '', ...(value.range ? { range: { startFrame: Number(value.range.startFrame), endFrame: Number(value.range.endFrame) } } : {}) };
}

// @nimi-authority: rule.nimi.runtime.ai-provider.voice-conversion
export function validateNimiLocalAppVoiceConvertSpec(value: unknown): NimiLocalAppVoiceConvertSpec {
  const record = asRecord(value); assertExactKeys(record, ['type', 'sourceVocal', 'sourceKind', 'targetVoice', 'semitoneShift'], 'voice conversion spec');
  if (!record || record.type !== 'audio-voice-convert' || record.sourceKind !== 'singing') inputError();
  const source = musicAudio(record.sourceVocal, 'voice conversion sourceVocal');
  const target = asRecord(record.targetVoice);
  assertExactKeys(target, ['kind', 'artifactId', 'range', 'presetVoiceId', 'voiceAssetId'], 'voice conversion targetVoice');
  if (target.kind === 'reference-audio') {
    assertExactKeys(target, ['kind', 'artifactId', 'range'], 'voice conversion targetVoice');
    const reference = musicAudio({ artifactId: target.artifactId, ...(target.range !== undefined ? { range: target.range } : {}) }, 'voice conversion targetVoice');
    if (reference.artifactId === source.artifactId) inputError();
  } else if (target.kind === 'preset') {
    assertExactKeys(target, ['kind', 'presetVoiceId'], 'voice conversion targetVoice');
    if (!identifier(target.presetVoiceId)) inputError();
  } else if (target.kind === 'voice-asset') {
    assertExactKeys(target, ['kind', 'voiceAssetId'], 'voice conversion targetVoice');
    if (!identifier(target.voiceAssetId)) inputError();
  } else inputError();
  if (record.semitoneShift !== undefined && !uint(record.semitoneShift, -12, 12)) inputError();
  return value as NimiLocalAppVoiceConvertSpec;
}

// @nimi-authority: rule.nimi.runtime.ai-provider.voice-conversion-length
export function validateNimiLocalAppVoiceConversion(value: unknown, artifactValues: unknown): NimiLocalAppVoiceConversion {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['vocalArtifactId', 'sourceArtifactId', 'sourceInfo', 'inputRange', 'vocalInfo', 'lengthRelation', 'durationDeltaMs'], 'voice conversion');
  if (!record || !identifier(record.vocalArtifactId) || !identifier(record.sourceArtifactId) || record.vocalArtifactId === record.sourceArtifactId
    || !Object.hasOwn(lengths, String(record.lengthRelation)) || !Array.isArray(artifactValues)) localAppProjectionError('voice conversion');
  const source = audioFacts(record.sourceInfo, 'voice conversion source facts');
  const vocal = audioFacts(record.vocalInfo, 'voice conversion vocal facts');
  const range = asRecord(record.inputRange); assertExactProjectionKeys(range, ['startFrame', 'endFrame'], 'voice conversion input range');
  if (!range || !uint(range.startFrame, 0, source.frameCount - 1) || !uint(range.endFrame, 1, source.frameCount) || range.endFrame <= range.startFrame) localAppProjectionError('voice conversion input range');
  const delta = record.durationDeltaMs;
  const sourceRangeDurationMs = Math.floor((range.endFrame - range.startFrame) * 1000 / source.sampleRateHz);
  if (typeof delta !== 'number' || !Number.isSafeInteger(delta) || delta !== vocal.durationMs - sourceRangeDurationMs) localAppProjectionError('voice conversion duration delta');
  if (record.lengthRelation === 'EXACT' && delta !== 0) localAppProjectionError('voice conversion length relation');
  if (record.lengthRelation === 'MODEL_FRAME_ROUNDING' && Math.abs(delta) >= 1000) localAppProjectionError('voice conversion length relation');
  if (artifactValues.length !== 1) localAppProjectionError('voice conversion artifact set');
  const artifact = asRecord(artifactValues[0]);
  if (!artifact || artifact.artifactId !== record.vocalArtifactId || artifact.mimeType !== 'audio/wav'
    || !uint(artifact.sizeBytes, vocal.frameCount * vocal.channels * 4 + 44, 512 * 1024 * 1024)
    || artifact.sampleRateHz !== vocal.sampleRateHz || artifact.channels !== vocal.channels || artifact.frameCount !== vocal.frameCount
    || artifact.durationMs !== vocal.durationMs) localAppProjectionError('voice conversion vocal artifact');
  return Object.freeze(value as NimiLocalAppVoiceConversion);
}

export function runtimeVoiceConvertSpec(value: NimiLocalAppVoiceConvertSpec): AudioVoiceConvertScenarioSpec {
  const target: VoiceConvertTargetVoice = value.targetVoice.kind === 'reference-audio'
    ? { target: { oneofKind: 'referenceAudio', referenceAudio: musicAudioInput(value.targetVoice) } }
    : value.targetVoice.kind === 'preset'
      ? { target: { oneofKind: 'presetVoiceId', presetVoiceId: value.targetVoice.presetVoiceId } }
      : { target: { oneofKind: 'voiceAssetId', voiceAssetId: value.targetVoice.voiceAssetId } };
  return { sourceVocal: musicAudioInput(value.sourceVocal), sourceKind: sourceKinds[value.sourceKind], targetVoice: target, semitoneShift: value.semitoneShift };
}

export function localVoiceConvertSpec(value: AudioVoiceConvertScenarioSpec): NimiLocalAppVoiceConvertSpec {
  const sourceKind = fromEnum(sourceKinds, value.sourceKind);
  const target = value.targetVoice?.target;
  const targetVoice = target && target.oneofKind === 'referenceAudio' ? { kind: 'reference-audio' as const, ...localMusicAudio(target.referenceAudio) }
    : target && target.oneofKind === 'presetVoiceId' ? { kind: 'preset' as const, presetVoiceId: target.presetVoiceId }
    : target && target.oneofKind === 'voiceAssetId' ? { kind: 'voice-asset' as const, voiceAssetId: target.voiceAssetId }
    : undefined;
  return validateNimiLocalAppVoiceConvertSpec({ type: 'audio-voice-convert', sourceVocal: localMusicAudio(value.sourceVocal ?? {}),
    ...(sourceKind ? { sourceKind } : {}), ...(targetVoice ? { targetVoice } : {}),
    ...(value.semitoneShift !== undefined ? { semitoneShift: value.semitoneShift } : {}) });
}

export function localVoiceConversion(value: VoiceConversion): unknown {
  return { vocalArtifactId: value.vocalArtifactId, sourceArtifactId: value.sourceArtifactId,
    sourceInfo: value.sourceInfo ? { ...value.sourceInfo, frameCount: Number(value.sourceInfo.frameCount), durationMs: Number(value.sourceInfo.durationMs) } : undefined,
    inputRange: value.inputRange ? { startFrame: Number(value.inputRange.startFrame), endFrame: Number(value.inputRange.endFrame) } : undefined,
    vocalInfo: value.vocalInfo ? { ...value.vocalInfo, frameCount: Number(value.vocalInfo.frameCount), durationMs: Number(value.vocalInfo.durationMs) } : undefined,
    lengthRelation: fromEnum(lengths, value.lengthRelation), durationDeltaMs: Number(value.durationDeltaMs) };
}

export function runtimeVoiceConversion(value: NimiLocalAppVoiceConversion | undefined): VoiceConversion | undefined {
  if (!value) return undefined;
  return { vocalArtifactId: value.vocalArtifactId, sourceArtifactId: value.sourceArtifactId,
    sourceInfo: { ...value.sourceInfo, frameCount: String(value.sourceInfo.frameCount), durationMs: String(value.sourceInfo.durationMs) },
    inputRange: { startFrame: String(value.inputRange.startFrame), endFrame: String(value.inputRange.endFrame) },
    vocalInfo: { ...value.vocalInfo, frameCount: String(value.vocalInfo.frameCount), durationMs: String(value.vocalInfo.durationMs) },
    lengthRelation: lengths[value.lengthRelation], durationDeltaMs: String(value.durationDeltaMs) };
}

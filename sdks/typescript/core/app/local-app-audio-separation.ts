import { asRecord, assertExactProjectionKeys, localAppProjectionError } from './local-app-runtime-platform-validation.js';
import { AudioInstrumentPartKind, type AudioInstrumentPart, type AudioSeparation } from '../../core-generated/runtime-typed-client.js';

export type NimiLocalAppAudioInstrumentPartKind = 'DRUMS' | 'BASS' | 'OTHER';
export type NimiLocalAppAudioInstrumentPart = {
  readonly kind: NimiLocalAppAudioInstrumentPartKind;
  readonly artifactId: string;
};
export type NimiLocalAppAudioSeparation = {
  readonly vocalsArtifactId: string;
  readonly backgroundArtifactId: string;
  readonly instrumentParts?: readonly NimiLocalAppAudioInstrumentPart[];
};
const instrumentKinds: Record<NimiLocalAppAudioInstrumentPartKind, AudioInstrumentPartKind> = {
  DRUMS: AudioInstrumentPartKind.DRUMS, BASS: AudioInstrumentPartKind.BASS, OTHER: AudioInstrumentPartKind.OTHER,
};

// @nimi-authority: rule.nimi.runtime.ai-provider.audio-separation
export function validateNimiLocalAppAudioSeparation(value: unknown, artifactsValue: unknown): NimiLocalAppAudioSeparation {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['vocalsArtifactId', 'backgroundArtifactId', ...(record && Object.hasOwn(record, 'instrumentParts') ? ['instrumentParts'] : [])], 'audio separation');
  const ids = [record.vocalsArtifactId, record.backgroundArtifactId];
  const rawParts = record.instrumentParts === undefined ? [] : record.instrumentParts;
  if (!Array.isArray(rawParts) || rawParts.length > 3) localAppProjectionError('audio separation instrument parts');
  const parts: NimiLocalAppAudioInstrumentPart[] = [];
  const kinds = new Set<string>();
  for (const candidate of rawParts) {
    const part = asRecord(candidate); assertExactProjectionKeys(part, ['kind', 'artifactId'], 'audio separation instrument part');
    const id = part?.artifactId;
    if (!part || !Object.hasOwn(instrumentKinds, String(part.kind)) || kinds.has(String(part.kind))
      || typeof id !== 'string' || !id || id !== id.trim() || id.length > 128 || ids.includes(id) || parts.some((entry) => entry.artifactId === id)) {
      localAppProjectionError('audio separation instrument part');
    }
    kinds.add(String(part.kind));
    parts.push({ kind: part.kind as NimiLocalAppAudioInstrumentPartKind, artifactId: id });
  }
  if (!Array.isArray(artifactsValue) || artifactsValue.length !== 2 + parts.length || ids[0] === ids[1]) localAppProjectionError('audio separation pair');
  const vocals = asRecord(artifactsValue[0]);
  const background = asRecord(artifactsValue[1]);
  if (!vocals || !background) localAppProjectionError('audio separation artifacts');
  const artifacts = [vocals, background] as const;
  for (let index = 0; index < 2; index += 1) {
    const id = ids[index];
    const artifact = artifacts[index];
    if (typeof id !== 'string' || !id || id !== id.trim() || id.length > 128 || artifact?.artifactId !== id
      || typeof artifact.mimeType !== 'string' || !artifact.mimeType.startsWith('audio/')
      || typeof artifact.sizeBytes !== 'number' || !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0
      || typeof artifact.sampleRateHz !== 'number' || !Number.isSafeInteger(artifact.sampleRateHz) || artifact.sampleRateHz <= 0
      || typeof artifact.channels !== 'number' || !Number.isSafeInteger(artifact.channels) || artifact.channels <= 0
      || typeof artifact.durationMs !== 'number' || !Number.isSafeInteger(artifact.durationMs) || artifact.durationMs < 0) {
      localAppProjectionError('audio separation artifact');
    }
  }
  const remaining = new Map(parts.map((part) => [part.artifactId, part] as const));
  for (const candidate of artifactsValue.slice(2)) {
    const artifact = asRecord(candidate);
    const match = artifact && remaining.get(String(artifact.artifactId));
    if (!artifact || !match
      || typeof artifact.mimeType !== 'string' || !artifact.mimeType.startsWith('audio/')
      || typeof artifact.sizeBytes !== 'number' || !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0
      || typeof artifact.sampleRateHz !== 'number' || !Number.isSafeInteger(artifact.sampleRateHz) || artifact.sampleRateHz <= 0
      || typeof artifact.channels !== 'number' || !Number.isSafeInteger(artifact.channels) || artifact.channels <= 0
      || typeof artifact.durationMs !== 'number' || !Number.isSafeInteger(artifact.durationMs) || artifact.durationMs < 0) {
      localAppProjectionError('audio separation instrument part artifact');
    }
    remaining.delete(String(artifact.artifactId));
  }
  if (remaining.size) localAppProjectionError('audio separation instrument part artifact');
  for (const candidate of artifactsValue.slice(2)) {
    const artifact = asRecord(candidate)!;
    if (artifacts[0].sampleRateHz !== artifact.sampleRateHz || artifacts[0].channels !== artifact.channels || artifacts[0].durationMs !== artifact.durationMs) {
      localAppProjectionError('audio separation timeline');
    }
  }
  if (artifacts[0].sampleRateHz !== artifacts[1].sampleRateHz || artifacts[0].channels !== artifacts[1].channels
    || artifacts[0].durationMs !== artifacts[1].durationMs) localAppProjectionError('audio separation timeline');
  return Object.freeze({
    vocalsArtifactId: ids[0] as string,
    backgroundArtifactId: ids[1] as string,
    ...(parts.length ? { instrumentParts: Object.freeze(parts.map((part) => Object.freeze({ ...part }))) } : {}),
  });
}

export function localAudioSeparation(value: AudioSeparation | undefined): unknown {
  if (!value) return undefined;
  return { vocalsArtifactId: value.vocalsArtifactId, backgroundArtifactId: value.backgroundArtifactId,
    ...(value.instrumentParts?.length ? { instrumentParts: value.instrumentParts.map((part) => ({
      kind: (Object.keys(instrumentKinds) as NimiLocalAppAudioInstrumentPartKind[]).find((kind) => instrumentKinds[kind] === part.part),
      artifactId: part.artifactId })) } : {}) };
}

export function runtimeAudioSeparation(value: NimiLocalAppAudioSeparation | undefined): AudioSeparation | undefined {
  if (!value) return undefined;
  return { vocalsArtifactId: value.vocalsArtifactId, backgroundArtifactId: value.backgroundArtifactId,
    instrumentParts: (value.instrumentParts ?? []).map((part): AudioInstrumentPart => ({ part: instrumentKinds[part.kind], artifactId: part.artifactId })) };
}

import { asRecord, assertExactProjectionKeys, localAppProjectionError } from './local-app-runtime-platform-validation.js';

export type NimiLocalAppAudioSeparation = {
  readonly vocalsArtifactId: string;
  readonly backgroundArtifactId: string;
};

// @nimi-authority: rule.nimi.runtime.ai-provider.audio-separation
export function validateNimiLocalAppAudioSeparation(value: unknown, artifactsValue: unknown): NimiLocalAppAudioSeparation {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['vocalsArtifactId', 'backgroundArtifactId'], 'audio separation');
  const ids = [record.vocalsArtifactId, record.backgroundArtifactId];
  if (!Array.isArray(artifactsValue) || artifactsValue.length !== 2 || ids[0] === ids[1]) localAppProjectionError('audio separation pair');
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
  if (artifacts[0].sampleRateHz !== artifacts[1].sampleRateHz || artifacts[0].channels !== artifacts[1].channels
    || artifacts[0].durationMs !== artifacts[1].durationMs) localAppProjectionError('audio separation timeline');
  return Object.freeze({ vocalsArtifactId: ids[0] as string, backgroundArtifactId: ids[1] as string });
}

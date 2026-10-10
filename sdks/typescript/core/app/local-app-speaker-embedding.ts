import { asRecord, assertExactProjectionKeys, localAppProjectionError } from './local-app-runtime-platform-validation.js';

export type NimiLocalAppSpeakerEmbedding = {
  readonly vector: readonly number[];
  readonly spaceId: string;
};

// @nimi-authority: rule.nimi.runtime.speaker-representation.audio-speaker-embedding-result
export function validateNimiLocalAppSpeakerEmbedding(value: unknown): NimiLocalAppSpeakerEmbedding {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['vector', 'spaceId'], 'speaker representation');
  if (typeof record.spaceId !== 'string' || record.spaceId !== record.spaceId.trim()
    || !record.spaceId || new TextEncoder().encode(record.spaceId).length > 128
    || !Array.isArray(record.vector) || record.vector.length < 1 || record.vector.length > 4096
    || record.vector.some((item: unknown) => typeof item !== 'number' || !Number.isFinite(item))
    || !record.vector.some((item: number) => item !== 0)) localAppProjectionError('speaker representation');
  return Object.freeze({ vector: Object.freeze([...record.vector]), spaceId: record.spaceId });
}

import type { StudioManagedArtifact } from './runtime-types.js';

/** App-owned references from the submitted inputs and every saved output role. */
export function studioResultAssetReferences(value: unknown): readonly Record<string, unknown>[] {
  if (!value || typeof value !== 'object' || (value as { ok?: unknown }).ok === false) return [];
  const result = value as Record<string, unknown>;
  const references: Record<string, unknown>[] = [];
  const add = (item: unknown) => {
    if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).relativePath === 'string') {
      references.push(item as Record<string, unknown>);
    }
  };
  const nested = (key: string) => result[key] && typeof result[key] === 'object' ? result[key] as Record<string, unknown> : {};
  add(result.sourceImage); add(result.preview); add(result.document);
  add(result.firstArtifact);
  if (Array.isArray(result.artifacts)) result.artifacts.forEach(add);
  const transcription = nested('musicTranscription');
  add(transcription.sourceAudio);
  if (Array.isArray(transcription.scores)) transcription.scores.forEach(add);
  const separation = nested('audioSeparation');
  add(separation.sourceAudio); add(separation.vocals); add(separation.background);
  if (Array.isArray(separation.instrumentParts)) separation.instrumentParts.forEach(part => add(part?.artifact));
  const conversion = nested('voiceConversion');
  add(conversion.sourceVocal); add(conversion.targetVoice); add(conversion.vocal);
  const generation = nested('musicGeneration');
  add(generation.generatedScore);
  if (typeof generation.mixRelativePath === 'string') add({ relativePath: generation.mixRelativePath });
  return references;
}

export function studioResultAssetPaths(value: unknown): string[] {
  return [...new Set(studioResultAssetReferences(value).map(item => item.relativePath as string))];
}

export function studioWorldInputSource(p: Readonly<Record<string, unknown>>): StudioManagedArtifact | undefined {
  if (!['ordinary', 'equirectangular-360'].includes(String(p.inputMode)) || typeof p.sourceRelativePath !== 'string' ||
      !/^world-tour\/inputs\/[0-9a-f-]+\.(png|jpg|webp)$/u.test(p.sourceRelativePath) ||
      !Number.isSafeInteger(p.sourceSizeBytes) || Number(p.sourceSizeBytes) < 1 || Number(p.sourceSizeBytes) > 20_000_000 ||
      typeof p.sourceSHA256 !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(p.sourceSHA256) ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(String(p.sourceMediaType)) ||
      !Number.isSafeInteger(p.sourceWidth) || !Number.isSafeInteger(p.sourceHeight) || Number(p.sourceWidth) < 1 || Number(p.sourceHeight) < 1 ||
      (p.inputMode === 'equirectangular-360' && p.sourceWidth !== 2 * Number(p.sourceHeight))) return undefined;
  return { relativePath: p.sourceRelativePath, mediaType: String(p.sourceMediaType), sizeBytes: Number(p.sourceSizeBytes),
    sha256: p.sourceSHA256, displayName: String(p.sourceName || ''), previewSource: 'managed-asset' };
}

/** The admitted full reader verifies the owner digest; exhaust it to observe all
 * integrity/retention failures, without retaining media bytes in renderer memory. */
export async function verifyStudioManagedAsset(
  assets: Pick<import('@nimiplatform/sdk/app').NimiLocalAppAssetsClient, 'read'>,
  expected: { readonly relativePath: string; readonly sha256?: string; readonly sizeBytes?: number; readonly mediaType?: string },
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const read = await assets.read({ relativePath: expected.relativePath });
  const iterator = read.body[Symbol.asyncIterator]();
  let size = 0;
  let closing: Promise<unknown> | undefined;
  const close = () => closing ??= Promise.resolve().then(() => iterator.return?.());
  const abort = () => { void close().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    if (read.asset.relativePath !== expected.relativePath || read.range.offset !== 0 || read.range.length !== read.asset.sizeBytes
      || (expected.sha256 !== undefined && read.asset.sha256 !== expected.sha256)
      || (expected.sizeBytes !== undefined && read.asset.sizeBytes !== expected.sizeBytes)
      || (expected.mediaType !== undefined && read.asset.mediaType !== expected.mediaType)) throw new Error('Saved asset no longer matches its result');
    for (;;) {
      signal?.throwIfAborted();
      const next = await iterator.next();
      signal?.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > read.asset.sizeBytes) throw new Error('Saved asset is larger than recorded');
    }
    if (size !== read.asset.sizeBytes) throw new Error('Saved asset is incomplete');
    signal?.throwIfAborted();
  } finally { signal?.removeEventListener('abort', abort); await close(); }
}

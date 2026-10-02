import { browserFilesToDataUrlAttachments, type BrowserDataUrlAttachment } from '@nimiplatform/kit/features/chat/headless';
import type { NimiLocalAppAssetsClient } from '@nimiplatform/sdk/app';
import type { StudioManagedArtifact } from './runtime-types.js';
import { studioDocumentSha256 } from './text-annotation-document.js';

/** Restore the saved input, never the current composer's unrelated attachment. */
export async function readStudioTextReplayMedia(
  assets: Pick<NimiLocalAppAssetsClient, 'read'>,
  source: StudioManagedArtifact,
  signal: AbortSignal,
): Promise<BrowserDataUrlAttachment> {
  if (!source.mediaType || !['image/jpeg', 'audio/wav', 'audio/mpeg', 'video/mp4'].includes(source.mediaType)
    || !Number.isSafeInteger(source.sizeBytes) || source.sizeBytes < 1 || source.sizeBytes > 32 * 1024 * 1024) {
    throw new Error('Saved input media is invalid');
  }
  signal.throwIfAborted();
  const read = await assets.read({ relativePath: source.relativePath });
  const bytes = new Uint8Array(source.sizeBytes);
  let offset = 0;
  const reader = read.body[Symbol.asyncIterator]();
  try {
    if (read.asset.sizeBytes !== source.sizeBytes || read.asset.sha256 !== source.sha256) {
      throw new Error('Saved input media no longer matches the history record');
    }
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.next();
      if (chunk.done) break;
      if (offset + chunk.value.byteLength > bytes.byteLength) throw new Error('Saved input media is larger than recorded');
      bytes.set(chunk.value, offset);
      offset += chunk.value.byteLength;
    }
  } finally {
    await reader.return?.();
  }
  if (offset !== bytes.byteLength || await studioDocumentSha256(bytes) !== source.sha256) {
    throw new Error('Saved input media is incomplete or changed');
  }
  signal.throwIfAborted();
  const [attachment] = await browserFilesToDataUrlAttachments(
    [new File([bytes], source.displayName || source.relativePath, { type: source.mediaType })],
    { idPrefix: 'studio-history', accept: [source.mediaType] },
  );
  signal.throwIfAborted();
  if (!attachment) throw new Error('Saved input media cannot be restored');
  return attachment;
}

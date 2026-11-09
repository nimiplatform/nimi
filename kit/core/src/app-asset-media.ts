import type { NimiLocalAppAssetsClient } from './sdk-contract.js';

// Presentation only: bytes come from the admitted App asset reader, never a
// PC file path, public server proxy, or synthetic native Host.
// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-030
export async function readNimiAppAssetBlob(
  assets: Pick<NimiLocalAppAssetsClient, 'read'>,
  relativePath: string,
  signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted();
  const read = await assets.read({ relativePath });
  const iterator = read.body[Symbol.asyncIterator]();
  let closing: Promise<unknown> | undefined;
  const close = () => closing ??= Promise.resolve().then(() => iterator.return?.());
  const abort = () => { void close().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  const parts: BlobPart[] = [];
  try {
    signal?.throwIfAborted();
    for (;;) {
      const next = await iterator.next();
      signal?.throwIfAborted();
      if (next.done) break;
      parts.push(new Uint8Array(next.value));
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    await close();
  }
  signal?.throwIfAborted();
  return new Blob(parts, { type: read.asset.mediaType });
}

export async function openNimiAppAssetMediaUrl(
  assets: Pick<NimiLocalAppAssetsClient, 'read'>,
  relativePath: string,
  signal?: AbortSignal,
  objectUrls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL,
): Promise<{ readonly url: string; readonly revoke: () => Promise<void> }> {
  const url = objectUrls.createObjectURL(await readNimiAppAssetBlob(assets, relativePath, signal));
  let revoked = false;
  return Object.freeze({ url, async revoke() {
    if (revoked) return;
    revoked = true; objectUrls.revokeObjectURL(url);
  } });
}

import type { NimiAppRuntimeClient } from '@nimiplatform/sdk/app';

type Assets = Pick<NimiAppRuntimeClient['storage']['assets'], 'write' | 'read'>;
export const LAB_FILE_MISMATCH = 'LAB_FILE_TRANSFER_MISMATCH';

// @nimi-authority: rule.nimi.runtime.remote-access.direct-transport
export async function writeLabFile(assets: Assets, file: File, relativePath: string, signal: AbortSignal, progress: (bytes: number) => void) {
  async function* body() {
    const reader = file.stream().getReader(); let read = 0;
    try {
      for (;;) {
        signal.throwIfAborted(); const next = await reader.read(); signal.throwIfAborted();
        if (next.done) return;
        read += next.value.byteLength; progress(read); yield next.value;
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  signal.throwIfAborted();
  const asset = await assets.write({ relativePath, body: body(), mediaType: file.type || 'application/octet-stream', overwrite: false });
  signal.throwIfAborted();
  if (asset.sizeBytes !== file.size || asset.relativePath !== relativePath) throw new Error(LAB_FILE_MISMATCH);
  return asset;
}

export async function verifyLabFile(assets: Assets, file: File, relativePath: string, signal: AbortSignal, progress: (bytes: number) => void) {
  signal.throwIfAborted();
  const result = await assets.read({ relativePath }); let offset = 0;
  const iterator = result.body[Symbol.asyncIterator]();
  try {
    if (result.asset.sizeBytes !== file.size || result.asset.relativePath !== relativePath) throw new Error(LAB_FILE_MISMATCH);
    for (;;) {
      signal.throwIfAborted();
      const next = await iterator.next();
      if (next.done) break;
      const chunk = next.value;
      signal.throwIfAborted();
      const expected = new Uint8Array(await file.slice(offset, offset + chunk.byteLength).arrayBuffer());
      signal.throwIfAborted();
      if (chunk.byteLength !== expected.byteLength || chunk.some((value, index) => value !== expected[index])) throw new Error(LAB_FILE_MISMATCH);
      offset += chunk.byteLength; progress(offset);
    }
    if (offset !== file.size) throw new Error(LAB_FILE_MISMATCH);
    return result.asset;
  } finally {
    await iterator.return?.().catch(() => undefined);
  }
}

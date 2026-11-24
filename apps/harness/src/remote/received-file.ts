import type { NimiAppScope } from '@nimiplatform/kit/auth/app';

type Asset = Awaited<ReturnType<NimiAppScope['client']['storage']['assets']['read']>>;
const previewBytes = 64 * 1024;
export const sessionFileLimit = 32 * 1024 * 1024;
const extensions: Record<string, string> = {
  'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv', 'application/json': 'json', 'application/pdf': 'pdf',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/flac': 'flac',
};

export type FileProgress = (loaded: number, total: number) => void;
const blockSize = 1024 * 1024;

export async function* uploadFile(file: Blob, signal: AbortSignal, progress: FileProgress) {
  // The SDK pulls this iterator under Runtime credits; the count is bytes read
  // from the device, not a claim that the PC has committed the attachment.
  for (let offset = 0; offset < file.size; offset += blockSize) {
    signal.throwIfAborted();
    const chunk = new Uint8Array(await file.slice(offset, offset + blockSize).arrayBuffer());
    signal.throwIfAborted();
    progress(offset + chunk.byteLength, file.size);
    yield chunk;
  }
}

export async function receiveFile(read: Asset, id: string, signal: AbortSignal, progress?: FileProgress, preferredName?: string) {
  const size = read.asset.sizeBytes;
  if (size > sessionFileLimit || size <= 0) throw new Error('Unexpected result size.');
  const parts: ArrayBuffer[] = [];
  let count = 0;
  for await (const chunk of read.body) {
    signal.throwIfAborted();
    count += chunk.byteLength;
    if (count > size) throw new Error('The received file size changed.');
    parts.push(Uint8Array.from(chunk).buffer);
    progress?.(count, size);
  }
  if (count !== size) throw new Error('Incomplete result file.');
  signal.throwIfAborted();
  const type = (read.asset.mediaType ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const blob = new Blob(parts, { type });
  const extension = extensions[type] ?? 'bin';
  // Render plain text in the app. Android WebView need not handle a blob download
  // in order to display the result, and Markdown never executes as page content.
  const text = ['txt', 'md', 'csv', 'json'].includes(extension) ? await blob.slice(0, previewBytes).text() : undefined;
  signal.throwIfAborted();
  return { blob, type, name: preferredName?.trim() || (id + '.' + extension), text, truncated: text !== undefined && size > previewBytes };
}

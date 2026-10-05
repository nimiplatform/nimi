import { getLabLocalAppClient } from '../shell/local-app-runtime-platform.js';

export type LabExportSaveResult = {
  artifactPath: string;
  filename: string;
  byteSize: number;
  revealed: boolean;
  mimeType?: string;
};

export async function saveLabExport(input: {
  filename: string;
  mimeType?: string;
  body: Blob | string;
}): Promise<LabExportSaveResult> {
  const blob = typeof input.body === 'string'
    ? new Blob([input.body], { type: input.mimeType || 'text/plain' })
    : input.body;
  const assets = getLabLocalAppClient().storage.assets;
  const saved = await assets.write({ relativePath: `exports/${crypto.randomUUID()}/${input.filename}`,
    body: blob, mediaType: input.mimeType || blob.type || undefined, overwrite: false });
  let revealed = false;
  try {
    await assets.reveal(saved.relativePath);
    revealed = true;
  } catch {
    // The write already completed. Preserve its facts even if the host cannot
    // show the location; never repeat the write while retrying reveal.
  }
  return { artifactPath: saved.relativePath, filename: input.filename, byteSize: saved.sizeBytes,
    revealed, ...(saved.mediaType ? { mimeType: saved.mediaType } : {}) };
}

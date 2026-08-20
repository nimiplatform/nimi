import { exportShellSaveFile } from '@nimiplatform/kit/shell/renderer/bridge';

export type LabExportSaveResult = {
  artifactPath: string;
  filename: string;
  byteSize: number;
  mimeType?: string;
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function saveLabExport(input: {
  filename: string;
  mimeType?: string;
  body: Blob | string;
}): Promise<LabExportSaveResult> {
  const blob = typeof input.body === 'string'
    ? new Blob([input.body], { type: input.mimeType || 'text/plain;charset=utf-8' })
    : input.body;
  const dataBase64 = arrayBufferToBase64(await blob.arrayBuffer());
  return exportShellSaveFile({
    filename: input.filename,
    mimeType: input.mimeType || blob.type || undefined,
    dataBase64,
    reveal: true,
  });
}

import {
  validateNimiLocalAppTextAnnotationResult,
  type NimiLocalAppAssetsClient,
  type NimiLocalAppTextAnnotationResult,
} from '@nimiplatform/sdk/app';
import type { StudioManagedArtifact } from './runtime-types.js';

export const STUDIO_TEXT_ANNOTATION_DOCUMENT_MEDIA_TYPE = 'application/json';
// The SDK bounds a validated annotation result to 16 MiB of JSON.
export const STUDIO_TEXT_ANNOTATION_DOCUMENT_MAX_BYTES = 16 * 1024 * 1024;

export function encodeStudioTextAnnotationDocument(result: NimiLocalAppTextAnnotationResult): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(result));
}

export async function studioDocumentSha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Reads a saved annotation document and accepts it only when its size and
 * digest still match the history reference and its content is a valid typed
 * annotation. A missing or altered document never renders as a saved result.
 */
export async function readStudioTextAnnotationDocument(
  assets: Pick<NimiLocalAppAssetsClient, 'read'>,
  document: StudioManagedArtifact,
): Promise<NimiLocalAppTextAnnotationResult> {
  if (document.mediaType !== STUDIO_TEXT_ANNOTATION_DOCUMENT_MEDIA_TYPE
    || document.sizeBytes < 1 || document.sizeBytes > STUDIO_TEXT_ANNOTATION_DOCUMENT_MAX_BYTES) {
    throw new Error(`Saved annotation reference is invalid: ${document.relativePath}`);
  }
  const read = await assets.read({ relativePath: document.relativePath });
  if (read.asset.sizeBytes !== document.sizeBytes || read.asset.sha256 !== document.sha256) {
    throw new Error(`Saved annotation no longer matches its history record: ${document.relativePath}`);
  }
  const bytes = new Uint8Array(document.sizeBytes);
  let offset = 0;
  for await (const chunk of read.body) {
    if (offset + chunk.byteLength > bytes.byteLength) throw new Error(`Saved annotation is larger than recorded: ${document.relativePath}`);
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (offset !== bytes.byteLength) throw new Error(`Saved annotation is incomplete: ${document.relativePath}`);
  if (await studioDocumentSha256(bytes) !== document.sha256) {
    throw new Error(`Saved annotation digest does not match: ${document.relativePath}`);
  }
  return validateNimiLocalAppTextAnnotationResult(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown);
}

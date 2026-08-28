import path from 'node:path';
import { lstat, readFile } from 'node:fs/promises';
import { createElectronCapabilityUnavailableError } from './errors.js';
import { canonicalElectronPathCandidate } from './paths.js';
import {
  MAX_BACKGROUND_BYTES,
  MAX_BACKGROUND_PIXELS,
  invalidPath,
  invalidPayload,
} from './agent-center-contract.js';
import { backgroundMimeForPath, decodeImageDimensions } from './agent-center-content.js';
import { sha256 } from './agent-center-paths.js';
import type { NimiElectronStandardShellHost } from './types.js';

export async function importBackground(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) {
  void payload;
  const source = await selectBackgroundMaterial(host, command);
  if (!source) return null;
  const mime = backgroundMimeForPath(source);
  if (!mime) throw invalidPayload(command, 'Background source must be png, jpeg, or webp');
  const sourceBytes = await readFile(source);
  if (sourceBytes.byteLength === 0 || sourceBytes.byteLength > MAX_BACKGROUND_BYTES) {
    throw invalidPayload(command, 'Background image is outside the fixed byte cap');
  }
  const dimensions = await decodeImageDimensions(sourceBytes, mime, MAX_BACKGROUND_PIXELS);
  if (!dimensions) {
    throw invalidPayload(command, 'Background image signature or dimensions are invalid');
  }

  const digest = sha256(sourceBytes);
  return {
    role: 'background',
    fileName: path.basename(source),
    mediaType: mime,
    content: Uint8Array.from(sourceBytes),
    sha256: digest,
    custodyRef: `agent-center-import-custody:${digest.slice(0, 24)}`,
  };
}

async function selectBackgroundMaterial(
  host: NimiElectronStandardShellHost | undefined,
  command: string,
): Promise<string | null> {
  const openFileDialog = host?.openFileDialog;
  if (!openFileDialog) throw createElectronCapabilityUnavailableError(command);
  const result = await openFileDialog({
    kind: 'file',
    title: 'Select background image',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    multiple: false,
  });
  if (result.canceled || result.paths.length === 0) return null;
  if (result.paths.length !== 1 || !result.paths[0]?.trim()) {
    throw invalidPayload(command, 'Agent Center native selection must return exactly one file.');
  }
  const raw = path.resolve(result.paths[0]);
  const metadata = await lstat(raw).catch(() => undefined);
  if (!metadata || metadata.isSymbolicLink() || !metadata.isFile()) {
    throw invalidPath(command, 'Selected background material is missing or is not a regular file.');
  }
  try {
    return await canonicalElectronPathCandidate(raw);
  } catch {
    throw invalidPath(command, 'Selected background material could not be resolved.');
  }
}

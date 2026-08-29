import path from 'node:path';
import { lstat, readFile } from 'node:fs/promises';
import { createElectronCapabilityUnavailableError } from './errors.js';
import { canonicalElectronPathCandidate } from './paths.js';
import {
  MAX_RESOURCE_PACK_BYTES,
  invalidPath,
  invalidPayload,
} from './agent-center-contract.js';
import { sha256 } from './agent-center-paths.js';
import type { NimiElectronStandardShellHost } from './types.js';

export async function importResourcePack(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) {
  void payload;
  const source = await selectResourcePackMaterial(host, command);
  if (!source) return null;
  if (path.extname(source).toLowerCase() !== '.nimipack') {
    throw invalidPayload(command, 'Resource Pack source must use the .nimipack extension');
  }
  const metadata = await lstat(source).catch(() => undefined);
  if (!metadata || !metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_RESOURCE_PACK_BYTES) {
    throw invalidPayload(command, 'Resource Pack archive is outside the 2 MiB compressed byte cap');
  }
  const sourceBytes = await readFile(source);
  if (sourceBytes.byteLength === 0 || sourceBytes.byteLength > MAX_RESOURCE_PACK_BYTES) {
    throw invalidPayload(command, 'Resource Pack archive is outside the 2 MiB compressed byte cap');
  }

  const digest = sha256(sourceBytes);
  return {
    role: 'resource-pack',
    fileName: path.basename(source),
    mediaType: 'application/vnd.nimi.resource-pack+zip',
    content: Uint8Array.from(sourceBytes),
    sha256: digest,
    custodyRef: `agent-center-import-custody:${digest.slice(0, 24)}`,
  };
}

async function selectResourcePackMaterial(
  host: NimiElectronStandardShellHost | undefined,
  command: string,
): Promise<string | null> {
  const openFileDialog = host?.openFileDialog;
  if (!openFileDialog) throw createElectronCapabilityUnavailableError(command);
  const result = await openFileDialog({
    kind: 'file',
    title: 'Select Nimi Resource Pack',
    filters: [{ name: 'Nimi Resource Pack', extensions: ['nimipack'] }],
    multiple: false,
  });
  if (result.canceled || result.paths.length === 0) return null;
  if (result.paths.length !== 1 || !result.paths[0]?.trim()) {
    throw invalidPayload(command, 'Agent Center native selection must return exactly one file.');
  }
  const raw = path.resolve(result.paths[0]);
  const metadata = await lstat(raw).catch(() => undefined);
  if (!metadata || metadata.isSymbolicLink() || !metadata.isFile()) {
    throw invalidPath(command, 'Selected Resource Pack is missing or is not a regular file.');
  }
  try {
    return await canonicalElectronPathCandidate(raw);
  } catch {
    throw invalidPath(command, 'Selected Resource Pack could not be resolved.');
  }
}

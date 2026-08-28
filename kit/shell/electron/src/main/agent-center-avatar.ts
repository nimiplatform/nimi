import path from 'node:path';
import { lstat, readFile, stat } from 'node:fs/promises';
import { createElectronCapabilityUnavailableError } from './errors.js';
import { canonicalElectronPathCandidate } from './paths.js';
import {
  invalidPath,
  invalidPayload,
  operationTimedOut,
  parseBackendKind,
  type AvatarBackendKind,
} from './agent-center-contract.js';
import { sha256 } from './agent-center-paths.js';
import type { NimiElectronStandardShellHost } from './types.js';

const AVATAR_MATERIAL_READ_TIMEOUT_MS = 30_000;

export async function importAvatarAsset(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) {
  const kind = parseBackendKind(payload.backendKind, command);
  const source = await selectAvatarMaterial(host, kind, command);
  if (!source) return null;
  const metadata = await stat(source);
  const extension = path.extname(source).toLowerCase();
  if (!metadata.isFile() || (kind === 'vrm' ? extension !== '.vrm' : extension !== '.zip')) {
    throw invalidPayload(command, kind === 'vrm'
      ? 'VRM material must be a selected .vrm file.'
      : 'Live2D material must be a selected .zip package.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new DOMException('Avatar material read timed out', 'TimeoutError'));
  }, AVATAR_MATERIAL_READ_TIMEOUT_MS);
  let content: Buffer;
  try {
    content = await readFile(source, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw operationTimedOut(
        command,
        `Avatar material read exceeded ${AVATAR_MATERIAL_READ_TIMEOUT_MS}ms and was canceled.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (content.byteLength === 0 || content.byteLength > 64 * 1024 * 1024) {
    throw invalidPayload(command, 'Avatar material is outside the bounded Runtime intake size.');
  }
  const digest = sha256(content);
  return {
    role: 'avatar',
    fileName: path.basename(source),
    mediaType: kind === 'vrm' ? 'model/gltf-binary' : 'application/zip',
    content: Uint8Array.from(content),
    sha256: digest,
    custodyRef: `agent-center-import-custody:${digest.slice(0, 24)}`,
    backendKind: kind,
  };
}

async function selectAvatarMaterial(
  host: NimiElectronStandardShellHost | undefined,
  kind: AvatarBackendKind,
  command: string,
): Promise<string | null> {
  const openFileDialog = host?.openFileDialog;
  if (!openFileDialog) throw createElectronCapabilityUnavailableError(command);
  const result = await openFileDialog({
    kind: 'file',
    title: kind === 'vrm' ? 'Select VRM file' : 'Select Live2D package',
    filters: kind === 'vrm'
      ? [{ name: 'VRM', extensions: ['vrm'] }]
      : [{ name: 'Live2D package', extensions: ['zip'] }],
    multiple: false,
  });
  if (result.canceled || result.paths.length === 0) return null;
  if (result.paths.length !== 1 || !result.paths[0]?.trim()) {
    throw invalidPayload(command, 'Agent Center native selection must return exactly one file.');
  }
  const raw = path.resolve(result.paths[0]);
  const metadata = await lstat(raw).catch(() => undefined);
  if (!metadata || metadata.isSymbolicLink() || !metadata.isFile()) {
    throw invalidPath(command, 'Selected Avatar material is missing or is not a regular file.');
  }
  try {
    return await canonicalElectronPathCandidate(raw);
  } catch {
    throw invalidPath(command, 'Selected Avatar material could not be resolved.');
  }
}

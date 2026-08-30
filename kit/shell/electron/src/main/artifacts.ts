import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { errorMessage } from './errors.js';
import {
  decodeElectronStandardBase64Bytes,
  normalizeText,
  resolveElectronStandardDataRootPath,
} from './paths.js';
import { NimiElectronShellHostError } from './types.js';
import type { NimiElectronStandardShellHost } from './types.js';

const ELECTRON_ARTIFACTS_SUBTREE = 'artifacts';

export type ElectronShellArtifactWriteResult = {
  readonly path: string;
  readonly byteSize: number;
  readonly mimeType?: string;
};

export async function writeElectronShellArtifact(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<ElectronShellArtifactWriteResult> {
  assertElectronArtifactsRelativePath(payload.relativePath, command);
  const mimeType = normalizeText(payload.mimeType) || undefined;
  const bytes = decodeElectronStandardBase64Bytes(payload.dataBase64, 'dataBase64', command);
  const filePath = await resolveElectronStandardDataRootPath(host, payload, command);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmpPath, bytes);
    await rename(tmpPath, filePath);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: `Electron standard artifact write failed: ${errorMessage(error)}`,
      reasonCode: 'electron-standard-artifact-write-failed',
      actionHint: 'inspect_standard_data_root_host_permissions',
      details: { command, path: filePath, cause: errorMessage(error) },
    });
  }
  await host?.localAssetProtocolHost?.registerReadableFile(filePath, 'data-root');
  return {
    path: filePath,
    byteSize: bytes.byteLength,
    mimeType,
  };
}

function assertElectronArtifactsRelativePath(value: unknown, command: string): void {
  const relativePath = normalizeText(value);
  const segments = relativePath.split(/[\\/]+/u).filter(Boolean);
  if (segments[0] !== ELECTRON_ARTIFACTS_SUBTREE || segments.length < 2) {
    throw new NimiElectronShellHostError({
      code: 'invalid-path',
      message: `Electron standard artifact relative path must stay inside the artifacts/ subtree: ${relativePath || '<missing>'}`,
      reasonCode: 'electron-standard-artifact-path-outside-artifacts-subtree',
      actionHint: 'prefix_artifact_relative_path_with_artifacts_subtree',
      details: { command, relativePath },
    });
  }
}

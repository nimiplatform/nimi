import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { createElectronCapabilityUnavailableError, errorMessage } from './errors.js';
import {
  decodeElectronStandardBase64Bytes,
  fileExists,
  normalizeRequiredToken,
  normalizeText,
} from './paths.js';
import { revealElectronShellFile } from './file-reveal.js';
import { NimiElectronShellHostError } from './types.js';
import type { NimiElectronStandardShellHost } from './types.js';

const FALLBACK_EXPORT_FILE_NAME = 'nimi-export';

export type ElectronShellExportSaveFileResult = {
  readonly artifactPath: string;
  readonly filename: string;
  readonly byteSize: number;
  readonly mimeType?: string;
};

export async function saveElectronShellExportFile(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<ElectronShellExportSaveFileResult> {
  const exportDirectory = host?.exportDirectory;
  if (!exportDirectory) {
    throw createElectronCapabilityUnavailableError(command);
  }
  const filename = normalizeRequiredToken(payload.filename, 'filename');
  const mimeType = normalizeText(payload.mimeType) || undefined;
  const bytes = decodeElectronStandardBase64Bytes(payload.dataBase64, 'dataBase64', command);
  const reveal = parseElectronExportRevealFlag(payload.reveal, command);
  if (reveal && !host.revealInOs) {
    throw createElectronCapabilityUnavailableError(command);
  }
  const outputDir = path.resolve(normalizeRequiredToken(await exportDirectory(), 'exportDirectory'));
  await mkdir(outputDir, { recursive: true });
  const artifactPath = await uniqueElectronExportOutputPath(outputDir, sanitizeElectronExportFilename(filename));
  await writeElectronExportBytesAtomically(artifactPath, bytes, command);
  await host.localAssetProtocolHost?.registerReadableFile(artifactPath);
  if (reveal) {
    await revealElectronShellFile(
      { ...host, localAssetRoots: [...(host.localAssetRoots ?? []), outputDir] },
      { path: artifactPath },
      command,
    );
  }
  return {
    artifactPath,
    filename: path.basename(artifactPath),
    byteSize: bytes.byteLength,
    mimeType,
  };
}

export function sanitizeElectronExportFilename(filename: string): string {
  const normalized = normalizeText(filename)
    .split('')
    .map((char) => /[a-zA-Z0-9._-]/u.test(char) ? char : '-')
    .join('');
  const collapsed = normalized.split('-').filter(Boolean).join('-');
  const trimmed = collapsed.replace(/^\.+|\.+$/gu, '').replace(/^-+|-+$/gu, '');
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    return FALLBACK_EXPORT_FILE_NAME;
  }
  return trimmed.slice(0, 180);
}

async function uniqueElectronExportOutputPath(outputDir: string, filename: string): Promise<string> {
  const candidate = path.join(outputDir, filename);
  if (!await fileExists(candidate)) {
    return candidate;
  }
  const parsed = path.parse(filename);
  const stem = parsed.name || FALLBACK_EXPORT_FILE_NAME;
  for (let index = 1; index < 10_000; index += 1) {
    const next = path.join(outputDir, `${stem}-${index}${parsed.ext}`);
    if (!await fileExists(next)) {
      return next;
    }
  }
  return path.join(outputDir, `${stem}-${Date.now()}${parsed.ext}`);
}

async function writeElectronExportBytesAtomically(
  artifactPath: string,
  bytes: Buffer,
  command: string,
): Promise<void> {
  const tmpPath = `${artifactPath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmpPath, bytes);
    await rename(tmpPath, artifactPath);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: `Electron export artifact write failed: ${errorMessage(error)}`,
      reasonCode: 'electron-export-artifact-write-failed',
      actionHint: 'inspect_export_directory_host_permissions',
      details: { command, path: artifactPath, cause: errorMessage(error) },
    });
  }
}

function parseElectronExportRevealFlag(value: unknown, command: string): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: 'Electron export reveal flag must be a boolean',
      reasonCode: 'electron-export-reveal-flag-invalid',
      actionHint: 'provide_boolean_reveal_flag',
      details: { command, valueType: typeof value },
    });
  }
  return value;
}

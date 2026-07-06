import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { NimiElectronShellHostError, type NimiElectronStandardShellHost } from './types.js';
import { errorMessage } from './errors.js';
import { fileExists, resolveElectronStandardDataRootPath, serializeElectronStandardJsonValue } from './paths.js';

export async function resolveElectronStandardDataPath(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<{ readonly path: string }> {
  return {
    path: await resolveElectronStandardDataRootPath(host, payload, command),
  };
}
export async function readElectronStandardStorageJson(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<{ readonly path: string; readonly value: unknown }> {
  const filePath = await resolveElectronStandardDataRootPath(host, payload, command);
  if (!await fileExists(filePath)) {
    throw new NimiElectronShellHostError({
      code: 'not-found',
      message: `Electron standard storage JSON was not found: ${filePath}`,
      reasonCode: 'electron-standard-storage-json-not-found',
      actionHint: 'write_storage_json_before_reading_it',
      details: { command, path: filePath },
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: `Electron standard storage JSON is invalid: ${errorMessage(error)}`,
      reasonCode: 'electron-standard-storage-json-invalid',
      actionHint: 'repair_or_replace_storage_json',
      details: { command, path: filePath, cause: errorMessage(error) },
    });
  }
  return { path: filePath, value };
}
export async function writeElectronStandardStorageJson(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<{ readonly path: string; readonly value: unknown }> {
  const filePath = await resolveElectronStandardDataRootPath(host, payload, command);
  const value = payload.value;
  const body = serializeElectronStandardJsonValue(value, command);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmpPath, body, 'utf8');
    await rename(tmpPath, filePath);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: `Electron standard storage JSON write failed: ${errorMessage(error)}`,
      reasonCode: 'electron-standard-storage-json-write-failed',
      actionHint: 'inspect_standard_storage_host_permissions',
      details: { command, path: filePath, cause: errorMessage(error) },
    });
  }
  return { path: filePath, value };
}

export async function removeElectronStandardStorageJson(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<{ readonly path: string; readonly removed: boolean }> {
  const filePath = await resolveElectronStandardDataRootPath(host, payload, command);
  if (!await fileExists(filePath)) {
    return { path: filePath, removed: false };
  }
  try {
    await rm(filePath, { force: true });
    return { path: filePath, removed: true };
  } catch (error) {
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: `Electron standard storage JSON remove failed: ${errorMessage(error)}`,
      reasonCode: 'electron-standard-storage-json-remove-failed',
      actionHint: 'inspect_standard_storage_host_permissions',
      details: { command, path: filePath, cause: errorMessage(error) },
    });
  }
}

import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  await writeFile(filePath, body, 'utf8');
  return { path: filePath, value };
}

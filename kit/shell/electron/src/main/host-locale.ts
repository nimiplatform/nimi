import { constants } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  parseNimiHostLocale,
  type NimiHostLocaleResult,
} from '@nimiplatform/kit/core/sdk-contract';
import { asRecord } from './paths.js';
import {
  NimiElectronShellHostError,
  type NimiElectronStandardShellHost,
} from './types.js';

const HOST_LOCALE_RELATIVE_PATH = ['.nimi', 'run', 'desktop', 'host-locale.v1.json'] as const;
const HOST_LOCALE_SCHEMA_VERSION = 1;
const MAX_HOST_LOCALE_FILE_BYTES = 4096;

export type ReadElectronHostLocaleInput = {
  readonly host: NimiElectronStandardShellHost | undefined;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly command: string;
};

export async function readElectronHostLocale(
  input: ReadElectronHostLocaleInput,
): Promise<NimiHostLocaleResult> {
  assertEmptyHostLocalePayload(input.payload, input.command);
  if (input.host?.readHostLocale) {
    return readHostLocaleFromCallback(input.host.readHostLocale);
  }
  return readHostLocaleFromDisk(input.host);
}

function assertEmptyHostLocalePayload(
  payload: Readonly<Record<string, unknown>>,
  command: string,
): void {
  const record = asRecord(
    payload,
    `Electron shell UI command ${command} payload must be an empty object`,
  );
  if (Reflect.ownKeys(record).length > 0) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: `Electron shell UI command ${command} does not accept request fields`,
      reasonCode: 'electron-shell-host-locale-payload-must-be-empty',
      actionHint: 'send_empty_host_locale_request',
      details: { command },
    });
  }
}

async function readHostLocaleFromCallback(
  readHostLocale: NonNullable<NimiElectronStandardShellHost['readHostLocale']>,
): Promise<NimiHostLocaleResult> {
  try {
    const raw = await readHostLocale();
    if (raw === null || raw === undefined) {
      return { locale: null };
    }
    return { locale: parseNimiHostLocale(raw) };
  } catch {
    return { locale: null };
  }
}

async function readHostLocaleFromDisk(
  host: NimiElectronStandardShellHost | undefined,
): Promise<NimiHostLocaleResult> {
  const filePath = host?.hostLocale?.filePath
    ? path.resolve(host.hostLocale.filePath)
    : path.join(homedir(), ...HOST_LOCALE_RELATIVE_PATH);
  try {
    await assertNoHostLocaleSymlink(filePath);
    const text = host?.hostLocale?.readTextFile
      ? await host.hostLocale.readTextFile(filePath)
      : await readBoundedRegularUtf8File(filePath);
    return { locale: parseHostLocaleFileContent(text) };
  } catch {
    return { locale: null };
  }
}

async function assertNoHostLocaleSymlink(filePath: string): Promise<void> {
  const normalizedPath = path.resolve(filePath);
  for (const ancestorPath of hostLocalePathAncestors(normalizedPath)) {
    const stat = await lstat(ancestorPath);
    if (stat.isSymbolicLink()) {
      throw new Error('Host locale path ancestry must not contain symlinks.');
    }
    if (ancestorPath === normalizedPath) {
      if (!stat.isFile()) {
        throw new Error('Host locale target must be a regular file.');
      }
      if (stat.size > MAX_HOST_LOCALE_FILE_BYTES) {
        throw new Error('Host locale file exceeds maximum size.');
      }
    } else if (!stat.isDirectory()) {
      throw new Error('Host locale ancestor must be a directory.');
    }
  }
}

function hostLocalePathAncestors(filePath: string): string[] {
  const parsed = path.parse(filePath);
  const ancestors: string[] = [];
  let current = parsed.root;
  if (current) {
    ancestors.push(current);
  }
  const relative = path.relative(parsed.root, filePath);
  for (const segment of relative.split(path.sep)) {
    if (!segment) {
      continue;
    }
    current = current ? path.join(current, segment) : segment;
    ancestors.push(current);
  }
  return ancestors;
}

async function readBoundedRegularUtf8File(filePath: string): Promise<string> {
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
  const handle: FileHandle = await open(filePath, constants.O_RDONLY | noFollow);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_HOST_LOCALE_FILE_BYTES) {
      throw new Error('Host locale file is invalid.');
    }
    return await handle.readFile({ encoding: 'utf8' });
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function parseHostLocaleFileContent(text: string): NimiHostLocaleResult['locale'] {
  if (Buffer.byteLength(text, 'utf8') > MAX_HOST_LOCALE_FILE_BYTES) {
    throw new Error('Host locale content exceeds maximum size.');
  }
  const raw = JSON.parse(text) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Host locale file must contain a JSON object.');
  }
  const record = raw as Record<string, unknown>;
  const ownKeys = Reflect.ownKeys(record);
  if (
    ownKeys.length !== 2
    || !Object.hasOwn(record, 'schemaVersion')
    || !Object.hasOwn(record, 'locale')
  ) {
    throw new Error('Host locale file must contain only schemaVersion and locale.');
  }
  if (record.schemaVersion !== HOST_LOCALE_SCHEMA_VERSION) {
    throw new Error('Host locale schemaVersion must be 1.');
  }
  return parseNimiHostLocale(record.locale);
}

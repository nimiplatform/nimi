import { constants } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

import { writeOwnerPrivateAtomicJson } from './owner-private-atomic-json.js';

export const DESKTOP_HOST_LOCALE_SCHEMA_VERSION = 1;
export const DESKTOP_HOST_LOCALE_RELATIVE_PATH = [
  '.nimi',
  'run',
  'desktop',
  'host-locale.v1.json',
] as const;

const MAX_HOST_LOCALE_FILE_BYTES = 4096;

export type DesktopHostLocale = 'en' | 'zh';

export type DesktopHostLocaleRecord = Readonly<{
  readonly schemaVersion: typeof DESKTOP_HOST_LOCALE_SCHEMA_VERSION;
  readonly locale: DesktopHostLocale;
}>;

export type DesktopHostLocaleStore = Readonly<{
  readonly filePath: string;
  initialize(osLocale: unknown): Promise<DesktopHostLocale>;
  sync(locale: DesktopHostLocale): Promise<void>;
  persistedLocale(): DesktopHostLocale | null;
}>;

export function resolveDesktopHostLocalePath(homeDirectory: string): string {
  const trimmed = typeof homeDirectory === 'string' ? homeDirectory.trim() : '';
  if (!trimmed) {
    throw new Error('desktop-host-locale-home-directory-required');
  }
  return path.join(path.resolve(trimmed), ...DESKTOP_HOST_LOCALE_RELATIVE_PATH);
}

export function normalizeDesktopHostLocale(raw: unknown): DesktopHostLocale {
  if (typeof raw !== 'string') return 'en';
  return raw.trim().toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function parseDesktopHostLocale(value: unknown): DesktopHostLocale {
  if (value === 'en' || value === 'zh') return value;
  throw new Error('desktop-host-locale-invalid');
}

export function parseDesktopHostLocaleRecord(value: unknown): DesktopHostLocaleRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('desktop-host-locale-invalid');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== 'locale' || keys[1] !== 'schemaVersion') {
    throw new Error('desktop-host-locale-invalid');
  }
  if (record.schemaVersion !== DESKTOP_HOST_LOCALE_SCHEMA_VERSION) {
    throw new Error('desktop-host-locale-invalid');
  }
  return {
    schemaVersion: DESKTOP_HOST_LOCALE_SCHEMA_VERSION,
    locale: parseDesktopHostLocale(record.locale),
  };
}

export async function readDesktopHostLocale(filePath: string): Promise<DesktopHostLocale | null> {
  const presence = await assertNoSymlinkForRead(filePath);
  if (presence === 'missing') return null;

  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
  let handle: FileHandle;
  try {
    handle = await open(filePath, constants.O_RDONLY | noFollow);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT') return null;
    if (code === 'ELOOP') throw new Error('desktop-host-locale-must-not-be-symlink', { cause: error });
    throw error;
  }

  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new Error('desktop-host-locale-must-be-file');
    }
    if (metadata.size > MAX_HOST_LOCALE_FILE_BYTES) {
      throw new Error('desktop-host-locale-invalid');
    }
    const rawText = await handle.readFile({ encoding: 'utf8' });
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      throw new Error('desktop-host-locale-invalid');
    }
    return parseDesktopHostLocaleRecord(parsed).locale;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function writeDesktopHostLocale(
  filePath: string,
  locale: DesktopHostLocale,
): Promise<void> {
  const validated = parseDesktopHostLocale(locale);
  const record: DesktopHostLocaleRecord = {
    schemaVersion: DESKTOP_HOST_LOCALE_SCHEMA_VERSION,
    locale: validated,
  };
  await writeOwnerPrivateAtomicJson(filePath, record, 'desktop-host-locale');
}

export function createDesktopHostLocaleStore(input: {
  readonly homeDirectory: string;
  readonly reportError?: (operation: 'read' | 'write', error: unknown) => void;
}): DesktopHostLocaleStore {
  const filePath = resolveDesktopHostLocalePath(input.homeDirectory);
  let persisted: DesktopHostLocale | null = null;
  let desired: DesktopHostLocale | null = null;
  let pendingWrite: Promise<void> = Promise.resolve();

  const enqueueWrite = (locale: DesktopHostLocale): Promise<void> => {
    const validated = parseDesktopHostLocale(locale);
    desired = validated;
    const task = pendingWrite.then(async () => {
      if (desired !== validated) return;
      if (persisted === validated) return;
      try {
        await writeDesktopHostLocale(filePath, validated);
        persisted = validated;
      } catch (error) {
        input.reportError?.('write', error);
      }
    });
    pendingWrite = task;
    return task;
  };

  return Object.freeze({
    filePath,
    persistedLocale: () => persisted,
    async initialize(osLocale: unknown): Promise<DesktopHostLocale> {
      const fallback = normalizeDesktopHostLocale(osLocale);
      let existing: DesktopHostLocale | null = null;
      let symlinkRefused = false;
      try {
        existing = await readDesktopHostLocale(filePath);
      } catch (error) {
        input.reportError?.('read', error);
        const message = error instanceof Error ? error.message : '';
        if (message.includes('must-not-be-symlink')) {
          symlinkRefused = true;
        }
      }
      if (existing !== null) {
        persisted = existing;
        return existing;
      }
      if (!symlinkRefused) {
        await enqueueWrite(fallback);
      }
      return fallback;
    },
    sync(locale: DesktopHostLocale): Promise<void> {
      const validated = parseDesktopHostLocale(locale);
      if (persisted === validated && (desired === null || desired === validated)) {
        return pendingWrite;
      }
      return enqueueWrite(validated);
    },
  });
}

async function assertNoSymlinkForRead(targetPath: string): Promise<'present' | 'missing'> {
  const resolved = path.resolve(targetPath);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  const segments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]!);
    const isTarget = index === segments.length - 1;
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) {
        throw new Error(
          isTarget
            ? 'desktop-host-locale-must-not-be-symlink'
            : 'desktop-host-locale-parent-must-not-be-symlink',
        );
      }
      if (isTarget) {
        if (!metadata.isFile()) {
          throw new Error('desktop-host-locale-must-be-file');
        }
      } else if (!metadata.isDirectory()) {
        throw new Error('desktop-host-locale-parent-must-be-directory');
      }
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        return 'missing';
      }
      throw error;
    }
  }
  return 'present';
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

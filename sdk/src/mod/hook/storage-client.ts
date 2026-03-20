import type { HookStorageClient } from '../types/storage';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-facade';

function normalizeStoragePath(path: string): string {
  const normalized = String(path || '').trim().replace(/\\/g, '/');
  if (!normalized || normalized === '.' || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error('mod storage path must be relative to the current mod');
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('mod storage path contains forbidden traversal segments');
  }
  return segments.join('/');
}

export function createStorageClient(input: {
  modId: string;
  runtime: RuntimeHookRuntimeFacade;
}): HookStorageClient {
  return {
    files: {
      readText: async (path) => {
        const result = await input.runtime.storage.files.readText({
          modId: input.modId,
          path: normalizeStoragePath(path),
        });
        return result.text || '';
      },
      writeText: (path, content) => input.runtime.storage.files.writeText({
        modId: input.modId,
        path: normalizeStoragePath(path),
        content,
      }),
      readBytes: async (path) => {
        const result = await input.runtime.storage.files.readBytes({
          modId: input.modId,
          path: normalizeStoragePath(path),
        });
        return result.bytes || new Uint8Array();
      },
      writeBytes: (path, content) => input.runtime.storage.files.writeBytes({
        modId: input.modId,
        path: normalizeStoragePath(path),
        content,
      }),
      delete: (path) => input.runtime.storage.files.delete({
        modId: input.modId,
        path: normalizeStoragePath(path),
      }),
      list: (path) => input.runtime.storage.files.list({
        modId: input.modId,
        path: normalizeStoragePath(path),
      }),
      stat: (path) => input.runtime.storage.files.stat({
        modId: input.modId,
        path: normalizeStoragePath(path),
      }),
    },
    sqlite: {
      query: ({ sql, params }) => input.runtime.storage.sqlite.query({
        modId: input.modId,
        sql,
        params,
      }),
      execute: ({ sql, params }) => input.runtime.storage.sqlite.execute({
        modId: input.modId,
        sql,
        params,
      }),
      transaction: ({ statements }) => input.runtime.storage.sqlite.transaction({
        modId: input.modId,
        statements,
      }),
    },
  };
}

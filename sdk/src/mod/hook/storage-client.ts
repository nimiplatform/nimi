import type { HookStorageClient } from '../types/storage';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-facade';

export function createStorageClient(input: {
  modId: string;
  runtime: RuntimeHookRuntimeFacade;
}): HookStorageClient {
  return {
    files: {
      readText: async (path) => {
        const result = await input.runtime.storage.files.readText({
          modId: input.modId,
          path,
        });
        return result.text || '';
      },
      writeText: (path, content) => input.runtime.storage.files.writeText({
        modId: input.modId,
        path,
        content,
      }),
      readBytes: async (path) => {
        const result = await input.runtime.storage.files.readBytes({
          modId: input.modId,
          path,
        });
        return result.bytes || new Uint8Array();
      },
      writeBytes: (path, content) => input.runtime.storage.files.writeBytes({
        modId: input.modId,
        path,
        content,
      }),
      delete: (path) => input.runtime.storage.files.delete({
        modId: input.modId,
        path,
      }),
      list: (path) => input.runtime.storage.files.list({
        modId: input.modId,
        path,
      }),
      stat: (path) => input.runtime.storage.files.stat({
        modId: input.modId,
        path,
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

import type { HookSourceType } from './shared';

export type HookStorageFileKind = 'file' | 'directory';

export type HookStorageFileEntry = {
  path: string;
  kind: HookStorageFileKind;
  sizeBytes: number;
  modifiedAt?: string;
};

export type HookStorageFileReadResult = {
  path: string;
  text?: string;
  bytes?: Uint8Array;
  sizeBytes: number;
  modifiedAt?: string;
};

export type HookStorageFileWriteResult = {
  path: string;
  sizeBytes: number;
  modifiedAt?: string;
};

export type HookStorageSqliteStatement = {
  sql: string;
  params?: unknown[];
};

export type HookStorageSqliteExecuteResult = {
  rowsAffected: number;
  lastInsertRowid: number;
};

export type RuntimeHookStorageFacade = {
  storage: {
    files: {
      readText: (input: {
        modId: string;
        sourceType?: HookSourceType;
        path: string;
      }) => Promise<HookStorageFileReadResult>;
      writeText: (input: {
        modId: string;
        sourceType?: HookSourceType;
        path: string;
        content: string;
      }) => Promise<HookStorageFileWriteResult>;
      readBytes: (input: {
        modId: string;
        sourceType?: HookSourceType;
        path: string;
      }) => Promise<HookStorageFileReadResult>;
      writeBytes: (input: {
        modId: string;
        sourceType?: HookSourceType;
        path: string;
        content: Uint8Array;
      }) => Promise<HookStorageFileWriteResult>;
      delete: (input: {
        modId: string;
        sourceType?: HookSourceType;
        path: string;
      }) => Promise<boolean>;
      list: (input: {
        modId: string;
        sourceType?: HookSourceType;
        path?: string;
      }) => Promise<HookStorageFileEntry[]>;
      stat: (input: {
        modId: string;
        sourceType?: HookSourceType;
        path: string;
      }) => Promise<HookStorageFileEntry | null>;
    };
    sqlite: {
      query: (input: {
        modId: string;
        sourceType?: HookSourceType;
        sql: string;
        params?: unknown[];
      }) => Promise<Record<string, unknown>[]>;
      execute: (input: {
        modId: string;
        sourceType?: HookSourceType;
        sql: string;
        params?: unknown[];
      }) => Promise<HookStorageSqliteExecuteResult>;
      transaction: (input: {
        modId: string;
        sourceType?: HookSourceType;
        statements: HookStorageSqliteStatement[];
      }) => Promise<HookStorageSqliteExecuteResult>;
    };
  };
};

export type HookStorageClient = {
  files: {
    readText: (path: string) => Promise<string>;
    writeText: (path: string, content: string) => Promise<HookStorageFileWriteResult>;
    readBytes: (path: string) => Promise<Uint8Array>;
    writeBytes: (path: string, content: Uint8Array) => Promise<HookStorageFileWriteResult>;
    delete: (path: string) => Promise<boolean>;
    list: (path?: string) => Promise<HookStorageFileEntry[]>;
    stat: (path: string) => Promise<HookStorageFileEntry | null>;
  };
  sqlite: {
    query: (input: {
      sql: string;
      params?: unknown[];
    }) => Promise<Record<string, unknown>[]>;
    execute: (input: {
      sql: string;
      params?: unknown[];
    }) => Promise<HookStorageSqliteExecuteResult>;
    transaction: (input: {
      statements: HookStorageSqliteStatement[];
    }) => Promise<HookStorageSqliteExecuteResult>;
  };
};

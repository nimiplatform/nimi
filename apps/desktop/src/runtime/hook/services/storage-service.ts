import {
  deleteRuntimeModStoragePath,
  executeRuntimeModStorageSqlite,
  listRuntimeModStorage,
  queryRuntimeModStorageSqlite,
  readRuntimeModStorageBytes,
  readRuntimeModStorageText,
  statRuntimeModStoragePath,
  transactRuntimeModStorageSqlite,
  writeRuntimeModStorageBytes,
  writeRuntimeModStorageText,
} from '../../runtime-store/tauri-bridge';
import {
  storageFilesDeleteCapability,
  storageFilesListCapability,
  storageFilesReadCapability,
  storageFilesWriteCapability,
  storageSqliteExecuteCapability,
  storageSqliteQueryCapability,
  storageSqliteTransactionCapability,
} from '../contracts/capabilities.js';
import type { HookSourceType } from '../contracts/types.js';
import { HookAuditTrail } from '../audit/hook-audit.js';
import { createHookRecord, type PermissionResolver } from './utils.js';

export interface StorageServiceInput {
  audit: HookAuditTrail;
  evaluatePermission: PermissionResolver;
}

function createStorageTarget(domain: string, pathOrSql?: string): string {
  const suffix = String(pathOrSql || '').trim();
  return suffix ? `${domain}:${suffix}` : domain;
}

export class HookRuntimeStorageService {
  constructor(private readonly context: StorageServiceInput) {}

  private authorize(input: {
    modId: string;
    sourceType?: HookSourceType;
    capabilityKey: string;
    target: string;
    startedAt: number;
  }): {
    sourceType: HookSourceType;
    reasonCodes: string[];
  } {
    return this.context.evaluatePermission({
      modId: input.modId,
      sourceType: input.sourceType,
      hookType: 'storage',
      target: input.target,
      capabilityKey: input.capabilityKey,
      startedAt: input.startedAt,
    });
  }

  private appendAudit(input: {
    modId: string;
    startedAt: number;
    target: string;
    reasonCodes: string[];
  }): void {
    this.context.audit.append(createHookRecord({
      modId: input.modId,
      hookType: 'storage',
      target: input.target,
      decision: 'ALLOW',
      reasonCodes: input.reasonCodes,
      startedAt: input.startedAt,
    }));
  }

  async readText(input: {
    modId: string;
    sourceType?: HookSourceType;
    path: string;
  }) {
    const startedAt = Date.now();
    const permission = this.authorize({
      modId: input.modId,
      sourceType: input.sourceType,
      capabilityKey: storageFilesReadCapability(),
      target: createStorageTarget('files.read', input.path),
      startedAt,
    });
    const result = await readRuntimeModStorageText({
      modId: input.modId,
      path: input.path,
    });
    this.appendAudit({
      modId: input.modId,
      startedAt,
      target: createStorageTarget('files.read', input.path),
      reasonCodes: permission.reasonCodes,
    });
    return result;
  }

  async writeText(input: {
    modId: string;
    sourceType?: HookSourceType;
    path: string;
    content: string;
  }) {
    const startedAt = Date.now();
    const permission = this.authorize({
      modId: input.modId,
      sourceType: input.sourceType,
      capabilityKey: storageFilesWriteCapability(),
      target: createStorageTarget('files.write', input.path),
      startedAt,
    });
    const result = await writeRuntimeModStorageText({
      modId: input.modId,
      path: input.path,
      text: input.content,
    });
    this.appendAudit({
      modId: input.modId,
      startedAt,
      target: createStorageTarget('files.write', input.path),
      reasonCodes: permission.reasonCodes,
    });
    return result;
  }

  async readBytes(input: {
    modId: string;
    sourceType?: HookSourceType;
    path: string;
  }) {
    const startedAt = Date.now();
    const permission = this.authorize({
      modId: input.modId,
      sourceType: input.sourceType,
      capabilityKey: storageFilesReadCapability(),
      target: createStorageTarget('files.read', input.path),
      startedAt,
    });
    const result = await readRuntimeModStorageBytes({
      modId: input.modId,
      path: input.path,
    });
    this.appendAudit({
      modId: input.modId,
      startedAt,
      target: createStorageTarget('files.read', input.path),
      reasonCodes: permission.reasonCodes,
    });
    return result;
  }

  async writeBytes(input: {
    modId: string;
    sourceType?: HookSourceType;
    path: string;
    content: Uint8Array;
  }) {
    const startedAt = Date.now();
    const permission = this.authorize({
      modId: input.modId,
      sourceType: input.sourceType,
      capabilityKey: storageFilesWriteCapability(),
      target: createStorageTarget('files.write', input.path),
      startedAt,
    });
    const result = await writeRuntimeModStorageBytes({
      modId: input.modId,
      path: input.path,
      bytes: input.content,
    });
    this.appendAudit({
      modId: input.modId,
      startedAt,
      target: createStorageTarget('files.write', input.path),
      reasonCodes: permission.reasonCodes,
    });
    return result;
  }

  async delete(input: {
    modId: string;
    sourceType?: HookSourceType;
    path: string;
  }): Promise<boolean> {
    const startedAt = Date.now();
    const permission = this.authorize({
      modId: input.modId,
      sourceType: input.sourceType,
      capabilityKey: storageFilesDeleteCapability(),
      target: createStorageTarget('files.delete', input.path),
      startedAt,
    });
    const result = await deleteRuntimeModStoragePath({
      modId: input.modId,
      path: input.path,
    });
    this.appendAudit({
      modId: input.modId,
      startedAt,
      target: createStorageTarget('files.delete', input.path),
      reasonCodes: permission.reasonCodes,
    });
    return result;
  }

  async list(input: {
    modId: string;
    sourceType?: HookSourceType;
    path?: string;
  }) {
    const startedAt = Date.now();
    const permission = this.authorize({
      modId: input.modId,
      sourceType: input.sourceType,
      capabilityKey: storageFilesListCapability(),
      target: createStorageTarget('files.list', input.path),
      startedAt,
    });
    const result = await listRuntimeModStorage({
      modId: input.modId,
      path: input.path,
    });
    this.appendAudit({
      modId: input.modId,
      startedAt,
      target: createStorageTarget('files.list', input.path),
      reasonCodes: permission.reasonCodes,
    });
    return result;
  }

  async stat(input: {
    modId: string;
    sourceType?: HookSourceType;
    path: string;
  }) {
    const startedAt = Date.now();
    const permission = this.authorize({
      modId: input.modId,
      sourceType: input.sourceType,
      capabilityKey: storageFilesReadCapability(),
      target: createStorageTarget('files.stat', input.path),
      startedAt,
    });
    const result = await statRuntimeModStoragePath({
      modId: input.modId,
      path: input.path,
    });
    this.appendAudit({
      modId: input.modId,
      startedAt,
      target: createStorageTarget('files.stat', input.path),
      reasonCodes: permission.reasonCodes,
    });
    return result;
  }

  async query(input: {
    modId: string;
    sourceType?: HookSourceType;
    sql: string;
    params?: unknown[];
  }) {
    const startedAt = Date.now();
    const permission = this.authorize({
      modId: input.modId,
      sourceType: input.sourceType,
      capabilityKey: storageSqliteQueryCapability(),
      target: createStorageTarget('sqlite.query', input.sql),
      startedAt,
    });
    const result = await queryRuntimeModStorageSqlite({
      modId: input.modId,
      sql: input.sql,
      params: input.params,
    });
    this.appendAudit({
      modId: input.modId,
      startedAt,
      target: createStorageTarget('sqlite.query', input.sql),
      reasonCodes: permission.reasonCodes,
    });
    return result.rows;
  }

  async execute(input: {
    modId: string;
    sourceType?: HookSourceType;
    sql: string;
    params?: unknown[];
  }) {
    const startedAt = Date.now();
    const permission = this.authorize({
      modId: input.modId,
      sourceType: input.sourceType,
      capabilityKey: storageSqliteExecuteCapability(),
      target: createStorageTarget('sqlite.execute', input.sql),
      startedAt,
    });
    const result = await executeRuntimeModStorageSqlite({
      modId: input.modId,
      sql: input.sql,
      params: input.params,
    });
    this.appendAudit({
      modId: input.modId,
      startedAt,
      target: createStorageTarget('sqlite.execute', input.sql),
      reasonCodes: permission.reasonCodes,
    });
    return result;
  }

  async transaction(input: {
    modId: string;
    sourceType?: HookSourceType;
    statements: Array<{
      sql: string;
      params?: unknown[];
    }>;
  }) {
    const startedAt = Date.now();
    const permission = this.authorize({
      modId: input.modId,
      sourceType: input.sourceType,
      capabilityKey: storageSqliteTransactionCapability(),
      target: createStorageTarget('sqlite.transaction', String(input.statements.length)),
      startedAt,
    });
    const result = await transactRuntimeModStorageSqlite({
      modId: input.modId,
      statements: input.statements,
    });
    this.appendAudit({
      modId: input.modId,
      startedAt,
      target: createStorageTarget('sqlite.transaction', String(input.statements.length)),
      reasonCodes: permission.reasonCodes,
    });
    return result;
  }
}

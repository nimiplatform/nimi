import { hasTauriInvoke, invokeTauri } from '../tauri-api';

type RuntimeAuditRecord = {
  id: string;
  modId?: string;
  stage?: string;
  eventType: string;
  decision?: string;
  reasonCodes?: string[];
  payload?: Record<string, unknown>;
  occurredAt: string;
};

export type RuntimeActionIdempotencyRecord = {
  principalId: string;
  actionId: string;
  idempotencyKey: string;
  inputDigest: string;
  response: Record<string, unknown>;
  occurredAt: string;
};

export type RuntimeActionVerifyTicketRecord = {
  ticketId: string;
  principalId: string;
  actionId: string;
  traceId: string;
  inputDigest: string;
  issuedAt: string;
  expiresAt: string;
};

export type RuntimeActionExecutionLedgerRecord = {
  executionId: string;
  actionId: string;
  principalId: string;
  phase: string;
  status: string;
  traceId: string;
  reasonCode?: string;
  payload?: Record<string, unknown>;
  occurredAt: string;
};

export type RuntimeActionExecutionLedgerFilter = {
  actionId?: string;
  principalId?: string;
  phase?: string;
  status?: string;
  traceId?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export type RuntimeExternalAgentTokenRecord = {
  tokenId: string;
  principalId: string;
  mode: string;
  subjectAccountId: string;
  actions: string[];
  scopes: Array<{ actionId: string; ops: string[] }>;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
};

export type RuntimeExternalAgentContextVerificationInput = {
  principalId: string;
  subjectAccountId: string;
  mode: 'delegated' | 'autonomous';
  issuer: string;
  authTokenId: string;
  bridgeExecutionId?: string;
};

export type RuntimeModStorageFileKind = 'file' | 'directory';

export type RuntimeModStorageFileEntry = {
  path: string;
  kind: RuntimeModStorageFileKind;
  sizeBytes: number;
  modifiedAt?: string;
};

export type RuntimeModStorageFileReadResult = {
  path: string;
  text?: string;
  bytes?: Uint8Array;
  sizeBytes: number;
  modifiedAt?: string;
};

export type RuntimeModStorageFileWriteResult = {
  path: string;
  sizeBytes: number;
  modifiedAt?: string;
};

export type RuntimeModStorageSqliteStatement = {
  sql: string;
  params?: unknown[];
};

export type RuntimeModStorageSqliteQueryResult = {
  rows: Record<string, unknown>[];
};

export type RuntimeModStorageSqliteExecuteResult = {
  rowsAffected: number;
  lastInsertRowid: number;
};

function readGlobalTauriInvoke() {
  if (!hasTauriInvoke()) {
    return null;
  }
  return invokeTauri;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseStorageFileEntry(value: unknown): RuntimeModStorageFileEntry | null {
  const row = asObject(value);
  const path = String(row.path || '').trim();
  const kind = String(row.kind || '').trim() === 'directory' ? 'directory' : 'file';
  const sizeBytes = Number(row.sizeBytes);
  if (!path || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return null;
  }
  const modifiedAt = String(row.modifiedAt || '').trim() || undefined;
  return {
    path,
    kind,
    sizeBytes,
    modifiedAt,
  };
}

function parseStorageFileReadResult(value: unknown): RuntimeModStorageFileReadResult | null {
  const row = asObject(value);
  const path = String(row.path || '').trim();
  const sizeBytes = Number(row.sizeBytes);
  if (!path || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return null;
  }
  const text = typeof row.text === 'string' ? row.text : undefined;
  const bytes = Array.isArray(row.bytes)
    ? Uint8Array.from(
      row.bytes
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 0 && item <= 255),
    )
    : undefined;
  const modifiedAt = String(row.modifiedAt || '').trim() || undefined;
  return {
    path,
    text,
    bytes,
    sizeBytes,
    modifiedAt,
  };
}

function parseStorageFileWriteResult(value: unknown): RuntimeModStorageFileWriteResult | null {
  const row = asObject(value);
  const path = String(row.path || '').trim();
  const sizeBytes = Number(row.sizeBytes);
  if (!path || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return null;
  }
  return {
    path,
    sizeBytes,
    modifiedAt: String(row.modifiedAt || '').trim() || undefined,
  };
}

function parseStorageSqliteExecuteResult(value: unknown): RuntimeModStorageSqliteExecuteResult | null {
  const row = asObject(value);
  const rowsAffected = Number(row.rowsAffected);
  const lastInsertRowid = Number(row.lastInsertRowid);
  if (!Number.isFinite(rowsAffected) || rowsAffected < 0 || !Number.isFinite(lastInsertRowid)) {
    return null;
  }
  return {
    rowsAffected,
    lastInsertRowid,
  };
}

export function hasRuntimeStoreInvoke() {
  return hasTauriInvoke();
}

export async function appendRuntimeAudit(record: RuntimeAuditRecord): Promise<void> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    return;
  }
  await invoke('runtime_mod_append_audit', { record });
}

export async function queryRuntimeAudit(filter?: {
  modId?: string;
  stage?: string;
  eventType?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<RuntimeAuditRecord[]> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    return [];
  }
  const result = await invoke('runtime_mod_query_audit', { filter: filter || {} });
  if (!Array.isArray(result)) {
    return [];
  }
  return result as RuntimeAuditRecord[];
}

export async function deleteRuntimeAudit(filter?: {
  modId?: string;
  stage?: string;
  eventType?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<number> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    return 0;
  }
  const result = await invoke('runtime_mod_delete_audit', { filter: filter || {} });
  const parsed = Number(result);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

export async function queryActionIdempotencyRecord(input: {
  principalId: string;
  actionId: string;
  idempotencyKey: string;
}): Promise<RuntimeActionIdempotencyRecord | null> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) return null;
  const result = await invoke('runtime_mod_get_action_idempotency', {
    payload: input,
  });
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }
  const row = result as Record<string, unknown>;
  const principalId = String(row.principalId || '').trim();
  const actionId = String(row.actionId || '').trim();
  const idempotencyKey = String(row.idempotencyKey || '').trim();
  const inputDigest = String(row.inputDigest || '').trim();
  const occurredAt = String(row.occurredAt || '').trim();
  const response = row.response && typeof row.response === 'object' && !Array.isArray(row.response)
    ? row.response as Record<string, unknown>
    : null;
  if (!principalId || !actionId || !idempotencyKey || !inputDigest || !occurredAt || !response) {
    return null;
  }
  return {
    principalId,
    actionId,
    idempotencyKey,
    inputDigest,
    occurredAt,
    response,
  };
}

export async function upsertActionIdempotencyRecord(input: RuntimeActionIdempotencyRecord): Promise<void> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) return;
  await invoke('runtime_mod_put_action_idempotency', {
    payload: input,
  });
}

export async function purgeActionIdempotencyRecords(before: string): Promise<number> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) return 0;
  const result = await invoke('runtime_mod_purge_action_idempotency', {
    payload: { before },
  });
  const count = Number(result);
  if (!Number.isFinite(count) || count < 0) return 0;
  return count;
}

export async function queryActionVerifyTicket(input: {
  ticketId: string;
}): Promise<RuntimeActionVerifyTicketRecord | null> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) return null;
  const result = await invoke('runtime_mod_get_action_verify_ticket', {
    payload: input,
  });
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }
  const row = result as Record<string, unknown>;
  const ticketId = String(row.ticketId || '').trim();
  const principalId = String(row.principalId || '').trim();
  const actionId = String(row.actionId || '').trim();
  const traceId = String(row.traceId || '').trim();
  const inputDigest = String(row.inputDigest || '').trim();
  const issuedAt = String(row.issuedAt || '').trim();
  const expiresAt = String(row.expiresAt || '').trim();
  if (!ticketId || !principalId || !actionId || !traceId || !inputDigest || !issuedAt || !expiresAt) {
    return null;
  }
  return {
    ticketId,
    principalId,
    actionId,
    traceId,
    inputDigest,
    issuedAt,
    expiresAt,
  };
}

export async function upsertActionVerifyTicket(input: RuntimeActionVerifyTicketRecord): Promise<void> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) return;
  await invoke('runtime_mod_put_action_verify_ticket', {
    payload: input,
  });
}

export async function deleteActionVerifyTicket(ticketId: string): Promise<number> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) return 0;
  const result = await invoke('runtime_mod_delete_action_verify_ticket', {
    payload: { ticketId },
  });
  const count = Number(result);
  if (!Number.isFinite(count) || count < 0) return 0;
  return count;
}

export async function purgeActionVerifyTickets(before: string): Promise<number> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) return 0;
  const result = await invoke('runtime_mod_purge_action_verify_tickets', {
    payload: { before },
  });
  const count = Number(result);
  if (!Number.isFinite(count) || count < 0) return 0;
  return count;
}

export async function upsertActionExecutionLedgerRecord(input: RuntimeActionExecutionLedgerRecord): Promise<void> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) return;
  await invoke('runtime_mod_put_action_execution_ledger', {
    payload: input,
  });
}

export async function queryActionExecutionLedger(
  filter?: RuntimeActionExecutionLedgerFilter,
): Promise<RuntimeActionExecutionLedgerRecord[]> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) return [];
  const result = await invoke('runtime_mod_query_action_execution_ledger', {
    filter: filter || {},
  });
  if (!Array.isArray(result)) return [];
  return result.map((entry) => {
    const row = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : {};
    return {
      executionId: String(row.executionId || '').trim(),
      actionId: String(row.actionId || '').trim(),
      principalId: String(row.principalId || '').trim(),
      phase: String(row.phase || '').trim(),
      status: String(row.status || '').trim(),
      traceId: String(row.traceId || '').trim(),
      reasonCode: String(row.reasonCode || '').trim() || undefined,
      payload: row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? row.payload as Record<string, unknown>
        : undefined,
      occurredAt: String(row.occurredAt || '').trim(),
    } satisfies RuntimeActionExecutionLedgerRecord;
  }).filter((item) => item.executionId && item.actionId && item.principalId && item.phase && item.status && item.traceId && item.occurredAt);
}

export async function purgeActionExecutionLedger(before: string): Promise<number> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) return 0;
  const result = await invoke('runtime_mod_purge_action_execution_ledger', {
    payload: { before },
  });
  const count = Number(result);
  if (!Number.isFinite(count) || count < 0) return 0;
  return count;
}

export async function listExternalAgentTokens(): Promise<RuntimeExternalAgentTokenRecord[]> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) return [];
  const result = await invoke('external_agent_list_tokens', {});
  if (!Array.isArray(result)) return [];
  return result.map((entry) => {
    const row = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : {};
    return {
      tokenId: String(row.tokenId || '').trim(),
      principalId: String(row.principalId || '').trim(),
      mode: String(row.mode || '').trim(),
      subjectAccountId: String(row.subjectAccountId || '').trim(),
      actions: Array.isArray(row.actions) ? row.actions.map((item) => String(item || '').trim()).filter(Boolean) : [],
      scopes: Array.isArray(row.scopes)
        ? row.scopes.map((item) => {
          const scope = item && typeof item === 'object' && !Array.isArray(item)
            ? item as Record<string, unknown>
            : {};
          return {
            actionId: String(scope.actionId || '').trim(),
            ops: Array.isArray(scope.ops) ? scope.ops.map((op) => String(op || '').trim()).filter(Boolean) : [],
          };
        }).filter((scope) => scope.actionId)
        : [],
      issuer: String(row.issuer || '').trim(),
      issuedAt: String(row.issuedAt || '').trim(),
      expiresAt: String(row.expiresAt || '').trim(),
      revokedAt: String(row.revokedAt || '').trim() || undefined,
    };
  }).filter((item) => item.tokenId && item.principalId);
}

export async function verifyExternalAgentExecutionContext(
  input: RuntimeExternalAgentContextVerificationInput,
): Promise<boolean> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    return false;
  }
  const result = await invoke('external_agent_verify_execution_context', {
    payload: input,
  });
  return result === true;
}

export async function readRuntimeModStorageText(input: {
  modId: string;
  path: string;
}): Promise<RuntimeModStorageFileReadResult> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    throw new Error('runtime mod storage file read requires Tauri runtime');
  }
  const result = await invoke('runtime_mod_storage_file_read', {
    payload: {
      modId: input.modId,
      path: input.path,
      format: 'text',
    },
  });
  const parsed = parseStorageFileReadResult(result);
  if (!parsed || typeof parsed.text !== 'string') {
    throw new Error('runtime mod storage file read returned invalid text payload');
  }
  return parsed;
}

export async function readRuntimeModStorageBytes(input: {
  modId: string;
  path: string;
}): Promise<RuntimeModStorageFileReadResult> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    throw new Error('runtime mod storage file read requires Tauri runtime');
  }
  const result = await invoke('runtime_mod_storage_file_read', {
    payload: {
      modId: input.modId,
      path: input.path,
      format: 'bytes',
    },
  });
  const parsed = parseStorageFileReadResult(result);
  if (!parsed || !parsed.bytes) {
    throw new Error('runtime mod storage file read returned invalid bytes payload');
  }
  return parsed;
}

export async function writeRuntimeModStorageText(input: {
  modId: string;
  path: string;
  text: string;
}): Promise<RuntimeModStorageFileWriteResult> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    throw new Error('runtime mod storage file write requires Tauri runtime');
  }
  const result = await invoke('runtime_mod_storage_file_write', {
    payload: {
      modId: input.modId,
      path: input.path,
      text: input.text,
    },
  });
  const parsed = parseStorageFileWriteResult(result);
  if (!parsed) {
    throw new Error('runtime mod storage file write returned invalid payload');
  }
  return parsed;
}

export async function writeRuntimeModStorageBytes(input: {
  modId: string;
  path: string;
  bytes: Uint8Array;
}): Promise<RuntimeModStorageFileWriteResult> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    throw new Error('runtime mod storage file write requires Tauri runtime');
  }
  const result = await invoke('runtime_mod_storage_file_write', {
    payload: {
      modId: input.modId,
      path: input.path,
      bytes: Array.from(input.bytes),
    },
  });
  const parsed = parseStorageFileWriteResult(result);
  if (!parsed) {
    throw new Error('runtime mod storage file write returned invalid payload');
  }
  return parsed;
}

export async function deleteRuntimeModStoragePath(input: {
  modId: string;
  path: string;
}): Promise<boolean> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    throw new Error('runtime mod storage file delete requires Tauri runtime');
  }
  const result = await invoke('runtime_mod_storage_file_delete', {
    payload: input,
  });
  return result === true;
}

export async function listRuntimeModStorage(input: {
  modId: string;
  path?: string;
}): Promise<RuntimeModStorageFileEntry[]> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    throw new Error('runtime mod storage file list requires Tauri runtime');
  }
  const result = await invoke('runtime_mod_storage_file_list', {
    payload: input,
  });
  if (!Array.isArray(result)) {
    throw new Error('runtime mod storage file list returned invalid payload');
  }
  return result
    .map(parseStorageFileEntry)
    .filter((entry): entry is RuntimeModStorageFileEntry => Boolean(entry));
}

export async function statRuntimeModStoragePath(input: {
  modId: string;
  path: string;
}): Promise<RuntimeModStorageFileEntry | null> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    throw new Error('runtime mod storage file stat requires Tauri runtime');
  }
  const result = await invoke('runtime_mod_storage_file_stat', {
    payload: input,
  });
  if (result == null) {
    return null;
  }
  const parsed = parseStorageFileEntry(result);
  if (!parsed) {
    throw new Error('runtime mod storage file stat returned invalid payload');
  }
  return parsed;
}

export async function queryRuntimeModStorageSqlite(input: {
  modId: string;
  sql: string;
  params?: unknown[];
}): Promise<RuntimeModStorageSqliteQueryResult> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    throw new Error('runtime mod storage sqlite query requires Tauri runtime');
  }
  const result = await invoke('runtime_mod_storage_sqlite_query', {
    payload: input,
  });
  const row = asObject(result);
  return {
    rows: Array.isArray(row.rows)
      ? row.rows.map((entry) => asObject(entry))
      : [],
  };
}

export async function executeRuntimeModStorageSqlite(input: {
  modId: string;
  sql: string;
  params?: unknown[];
}): Promise<RuntimeModStorageSqliteExecuteResult> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    throw new Error('runtime mod storage sqlite execute requires Tauri runtime');
  }
  const result = await invoke('runtime_mod_storage_sqlite_execute', {
    payload: input,
  });
  const parsed = parseStorageSqliteExecuteResult(result);
  if (!parsed) {
    throw new Error('runtime mod storage sqlite execute returned invalid payload');
  }
  return parsed;
}

export async function transactRuntimeModStorageSqlite(input: {
  modId: string;
  statements: RuntimeModStorageSqliteStatement[];
}): Promise<RuntimeModStorageSqliteExecuteResult> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    throw new Error('runtime mod storage sqlite transaction requires Tauri runtime');
  }
  const result = await invoke('runtime_mod_storage_sqlite_transaction', {
    payload: input,
  });
  const parsed = parseStorageSqliteExecuteResult(result);
  if (!parsed) {
    throw new Error('runtime mod storage sqlite transaction returned invalid payload');
  }
  return parsed;
}

export async function purgeRuntimeModStorageData(input: {
  modId: string;
}): Promise<boolean> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    throw new Error('runtime mod storage purge requires Tauri runtime');
  }
  const result = await invoke('runtime_mod_storage_data_purge', {
    payload: input,
  });
  return result === true;
}

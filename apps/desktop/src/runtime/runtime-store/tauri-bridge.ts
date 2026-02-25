type TauriInvoke = (command: string, payload?: unknown) => Promise<unknown>;
type TauriCore = {
  invoke?: TauriInvoke;
};
type TauriLikeGlobal = {
  window?: {
    __TAURI__?: {
      core?: TauriCore;
    };
  };
  __TAURI__?: {
    core?: TauriCore;
  };
};

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

function readGlobalTauriInvoke(): TauriInvoke | null {
  const value = globalThis as TauriLikeGlobal;
  const windowCore = value.window?.__TAURI__?.core;
  const fromWindow = windowCore?.invoke;
  if (typeof fromWindow === 'function') {
    return fromWindow.bind(windowCore);
  }

  const globalCore = value.__TAURI__?.core;
  const fromGlobal = globalCore?.invoke;
  if (typeof fromGlobal === 'function') {
    return fromGlobal.bind(globalCore);
  }

  return null;
}

export function hasRuntimeStoreInvoke() {
  return Boolean(readGlobalTauriInvoke());
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

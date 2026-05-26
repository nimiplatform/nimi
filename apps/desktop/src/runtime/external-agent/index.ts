import { tauriInvoke, hasTauriInvoke } from '@runtime/llm-adapter/tauri-bridge';

export type ExternalAgentIssueTokenPayload = {
  principalId: string;
  mode: 'delegated' | 'autonomous';
  subjectAccountId: string;
  actions: string[];
  scopes?: Array<{ actionId: string; ops: string[] }>;
  ttlSeconds?: number;
};

export type ExternalAgentIssueTokenResult = {
  token: string;
  tokenId: string;
  principalId?: string;
  mode?: 'delegated' | 'autonomous';
  subjectAccountId?: string;
  actions?: string[];
  scopes?: Array<{ actionId: string; ops: string[] }>;
  issuedAt?: string;
  expiresAt: string;
  revokedAt?: string;
  issuer: string;
};

export type ExternalAgentTokenRecord = {
  tokenId: string;
  principalId: string;
  mode: 'delegated' | 'autonomous';
  subjectAccountId: string;
  actions: string[];
  scopes: Array<{ actionId: string; ops: string[] }>;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
  issuer: string;
};

export type ExternalAgentGatewayStatus = {
  enabled: boolean;
  bindAddress: string;
  issuer: string;
  actionCount: number;
  status?: string;
  reasonCode?: string;
};

function asString(value: unknown): string {
  return String(value || '').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredString(value: unknown, field: string): string {
  const text = asString(value);
  if (!text) {
    throw new Error(`EXTERNAL_AGENT_TOKEN_LEDGER_FIELD_INVALID:${field}`);
  }
  return text;
}

function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`EXTERNAL_AGENT_TOKEN_LEDGER_FIELD_INVALID:${field}`);
  }
  return value.map((entry, index) => requiredString(entry, `${field}[${index}]`));
}

function parseExternalAgentTokenScope(value: unknown, index: number): { actionId: string; ops: string[] } {
  const scope = asRecord(value);
  if (Object.keys(scope).length === 0) {
    throw new Error(`EXTERNAL_AGENT_TOKEN_LEDGER_SCOPE_INVALID:${index}`);
  }
  return {
    actionId: requiredString(scope.actionId, `scopes[${index}].actionId`),
    ops: requiredStringArray(scope.ops, `scopes[${index}].ops`),
  };
}

function parseExternalAgentTokenRecord(value: unknown, index: number): ExternalAgentTokenRecord {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    throw new Error(`EXTERNAL_AGENT_TOKEN_LEDGER_RECORD_INVALID:${index}`);
  }
  const modeRaw = requiredString(record.mode, `tokens[${index}].mode`);
  if (modeRaw !== 'delegated' && modeRaw !== 'autonomous') {
    throw new Error(`EXTERNAL_AGENT_TOKEN_LEDGER_FIELD_INVALID:tokens[${index}].mode`);
  }
  if (!Array.isArray(record.scopes)) {
    throw new Error(`EXTERNAL_AGENT_TOKEN_LEDGER_FIELD_INVALID:tokens[${index}].scopes`);
  }
  return {
    tokenId: requiredString(record.tokenId, `tokens[${index}].tokenId`),
    principalId: requiredString(record.principalId, `tokens[${index}].principalId`),
    mode: modeRaw,
    subjectAccountId: requiredString(record.subjectAccountId, `tokens[${index}].subjectAccountId`),
    actions: requiredStringArray(record.actions, `tokens[${index}].actions`),
    scopes: record.scopes.map((entry, scopeIndex) => parseExternalAgentTokenScope(entry, scopeIndex)),
    issuedAt: requiredString(record.issuedAt, `tokens[${index}].issuedAt`),
    expiresAt: requiredString(record.expiresAt, `tokens[${index}].expiresAt`),
    revokedAt: asString(record.revokedAt) || undefined,
    issuer: requiredString(record.issuer, `tokens[${index}].issuer`),
  };
}

export function stopExternalAgentActionBridge(): void {
  // External Agent action bridge is Runtime-owned. Desktop teardown keeps this
  // no-op hook so bootstrap failure cleanup can remain uniform.
}

export async function issueExternalAgentToken(
  payload: ExternalAgentIssueTokenPayload,
): Promise<ExternalAgentIssueTokenResult> {
  if (!hasTauriInvoke()) {
    throw new Error('external_agent_issue_token requires Tauri runtime');
  }
  const result = await tauriInvoke<Record<string, unknown>>('external_agent_issue_token', { payload });
  return {
    token: asString(result.token),
    tokenId: asString(result.tokenId),
    principalId: asString(result.principalId) || undefined,
    mode: asString(result.mode) === 'autonomous'
      ? 'autonomous'
      : asString(result.mode) === 'delegated'
        ? 'delegated'
        : undefined,
    subjectAccountId: asString(result.subjectAccountId) || undefined,
    actions: Array.isArray(result.actions)
      ? result.actions.map((item) => asString(item)).filter(Boolean)
      : undefined,
    scopes: Array.isArray(result.scopes)
      ? result.scopes.map((item) => {
        const scope = asRecord(item);
        return {
          actionId: asString(scope.actionId),
          ops: Array.isArray(scope.ops) ? scope.ops.map((entry) => asString(entry)).filter(Boolean) : [],
        };
      }).filter((scope) => scope.actionId)
      : undefined,
    issuedAt: asString(result.issuedAt) || undefined,
    expiresAt: asString(result.expiresAt),
    revokedAt: asString(result.revokedAt) || undefined,
    issuer: asString(result.issuer),
  };
}

export async function revokeExternalAgentToken(tokenId: string): Promise<void> {
  if (!hasTauriInvoke()) return;
  await tauriInvoke('external_agent_revoke_token', {
    payload: { tokenId },
  });
}

export async function listExternalAgentTokens(): Promise<ExternalAgentTokenRecord[]> {
  if (!hasTauriInvoke()) {
    return [];
  }
  const result = await tauriInvoke<unknown>('external_agent_list_tokens', {});
  if (!Array.isArray(result)) {
    throw new Error('EXTERNAL_AGENT_TOKEN_LEDGER_INVALID_RESPONSE');
  }
  return result.map((item, index) => parseExternalAgentTokenRecord(item, index));
}

export async function getExternalAgentGatewayStatus(): Promise<ExternalAgentGatewayStatus> {
  if (!hasTauriInvoke()) {
    return {
      enabled: false,
      bindAddress: '127.0.0.1:0',
      issuer: 'local',
      actionCount: 0,
    };
  }
  const result = await tauriInvoke<Record<string, unknown>>('external_agent_gateway_status', {});
  return {
    enabled: Boolean(result.enabled),
    bindAddress: asString(result.bindAddress),
    issuer: asString(result.issuer),
    actionCount: Number.isFinite(Number(result.actionCount)) ? Number(result.actionCount) : 0,
    status: asString(result.status) || undefined,
    reasonCode: asString(result.reasonCode) || undefined,
  };
}

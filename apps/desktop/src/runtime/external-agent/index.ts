import { getPlatformClient } from '@nimiplatform/sdk';

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

function toIsoFromTimestamp(value: unknown): string {
  const record = asRecord(value);
  const seconds = Number(record.seconds);
  const nanos = Number(record.nanos);
  if (!Number.isFinite(seconds)) {
    return '';
  }
  const millis = (seconds * 1000) + (Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0);
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
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
  const result = await getPlatformClient().runtime.externalAgent.issueToken({
    principalId: payload.principalId,
    mode: payload.mode,
    subjectAccountId: payload.subjectAccountId,
    actions: payload.actions,
    scopes: (payload.scopes || []).map((scope) => ({
      actionId: scope.actionId,
      ops: scope.ops,
    })),
    ttlSeconds: payload.ttlSeconds || 0,
  });
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
    issuedAt: toIsoFromTimestamp(result.issuedAt) || undefined,
    expiresAt: toIsoFromTimestamp(result.expiresAt),
    revokedAt: toIsoFromTimestamp(result.revokedAt) || undefined,
    issuer: asString(result.issuer),
  };
}

export async function revokeExternalAgentToken(tokenId: string): Promise<void> {
  await getPlatformClient().runtime.externalAgent.revokeToken({ tokenId });
}

export async function listExternalAgentTokens(): Promise<ExternalAgentTokenRecord[]> {
  const result = await getPlatformClient().runtime.externalAgent.listTokens({
    pageSize: 0,
    pageToken: '',
    includeRevoked: false,
  });
  const tokens = result.tokens;
  if (!Array.isArray(tokens)) {
    throw new Error('EXTERNAL_AGENT_TOKEN_LEDGER_INVALID_RESPONSE');
  }
  return tokens.map((item, index) => parseExternalAgentTokenRecord({
    ...item,
    issuedAt: toIsoFromTimestamp(item.issuedAt),
    expiresAt: toIsoFromTimestamp(item.expiresAt),
    revokedAt: toIsoFromTimestamp(item.revokedAt),
  }, index));
}

export async function getExternalAgentGatewayStatus(): Promise<ExternalAgentGatewayStatus> {
  const result = await getPlatformClient().runtime.externalAgent.getGatewayStatus({});
  return {
    enabled: Boolean(result.enabled),
    bindAddress: asString(result.bindAddress),
    issuer: asString(result.issuer),
    actionCount: Number.isFinite(Number(result.actionCount)) ? Number(result.actionCount) : 0,
    status: asString(result.status) || undefined,
    reasonCode: asString(result.reasonCode) || undefined,
  };
}

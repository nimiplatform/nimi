import {
  assertRecord,
  parseOptionalString,
  parseRequiredString,
} from './shared.js';

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

export type ExternalAgentRevokeTokenPayload = {
  tokenId: string;
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

export function parseExternalAgentIssueTokenResult(value: unknown): ExternalAgentIssueTokenResult {
  const record = assertRecord(value, 'external_agent_issue_token returned invalid payload');
  const modeRaw = String(record.mode || '').trim();
  const mode = modeRaw === 'autonomous' ? 'autonomous' : modeRaw === 'delegated' ? 'delegated' : undefined;
  const actions = Array.isArray(record.actions)
    ? record.actions.map((entry) => String(entry || '').trim()).filter(Boolean)
    : undefined;
  const scopes = Array.isArray(record.scopes)
    ? record.scopes.map((entry) => {
      const scope = assertRecord(entry, 'external_agent_issue_token returned invalid scope');
      return {
        actionId: parseRequiredString(scope.actionId, 'actionId', 'external_agent_issue_token'),
        ops: Array.isArray(scope.ops) ? scope.ops.map((op) => String(op || '').trim()).filter(Boolean) : [],
      };
    })
    : undefined;
  return {
    token: parseRequiredString(record.token, 'token', 'external_agent_issue_token'),
    tokenId: parseRequiredString(record.tokenId, 'tokenId', 'external_agent_issue_token'),
    principalId: parseOptionalString(record.principalId),
    mode,
    subjectAccountId: parseOptionalString(record.subjectAccountId),
    actions,
    scopes,
    issuedAt: parseOptionalString(record.issuedAt),
    expiresAt: parseRequiredString(record.expiresAt, 'expiresAt', 'external_agent_issue_token'),
    revokedAt: parseOptionalString(record.revokedAt),
    issuer: parseRequiredString(record.issuer, 'issuer', 'external_agent_issue_token'),
  };
}

export function parseExternalAgentTokenRecord(value: unknown): ExternalAgentTokenRecord {
  const record = assertRecord(value, 'external_agent_list_tokens returned invalid payload');
  const modeRaw = String(record.mode || '').trim();
  const mode: 'delegated' | 'autonomous' = modeRaw === 'autonomous' ? 'autonomous' : 'delegated';
  const actions = Array.isArray(record.actions)
    ? record.actions.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const scopes = Array.isArray(record.scopes)
    ? record.scopes.map((entry) => {
      const scope = assertRecord(entry, 'external_agent_list_tokens returned invalid scope');
      return {
        actionId: parseRequiredString(scope.actionId, 'actionId', 'external_agent_list_tokens'),
        ops: Array.isArray(scope.ops) ? scope.ops.map((op) => String(op || '').trim()).filter(Boolean) : [],
      };
    })
    : [];
  return {
    tokenId: parseRequiredString(record.tokenId, 'tokenId', 'external_agent_list_tokens'),
    principalId: parseRequiredString(record.principalId, 'principalId', 'external_agent_list_tokens'),
    mode,
    subjectAccountId: parseRequiredString(record.subjectAccountId, 'subjectAccountId', 'external_agent_list_tokens'),
    actions,
    scopes,
    issuedAt: parseRequiredString(record.issuedAt, 'issuedAt', 'external_agent_list_tokens'),
    expiresAt: parseRequiredString(record.expiresAt, 'expiresAt', 'external_agent_list_tokens'),
    revokedAt: parseOptionalString(record.revokedAt),
    issuer: parseRequiredString(record.issuer, 'issuer', 'external_agent_list_tokens'),
  };
}

export function parseExternalAgentTokenRecordList(value: unknown): ExternalAgentTokenRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => parseExternalAgentTokenRecord(item));
}

export function parseExternalAgentGatewayStatus(value: unknown): ExternalAgentGatewayStatus {
  const record = assertRecord(value, 'external_agent_gateway_status returned invalid payload');
  return {
    enabled: Boolean(record.enabled),
    bindAddress: parseRequiredString(record.bindAddress, 'bindAddress', 'external_agent_gateway_status'),
    issuer: parseRequiredString(record.issuer, 'issuer', 'external_agent_gateway_status'),
    actionCount: Number.isFinite(Number(record.actionCount)) ? Number(record.actionCount) : 0,
    status: typeof record.status === 'string' ? record.status : undefined,
    reasonCode: typeof record.reasonCode === 'string' ? record.reasonCode : undefined,
  };
}

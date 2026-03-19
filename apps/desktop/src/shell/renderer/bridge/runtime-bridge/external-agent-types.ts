import {
  assertRecord,
  parseOptionalJsonObject,
  parseOptionalString,
  parseRequiredString,
} from './shared.js';
import type { JsonObject } from './shared.js';
export type ExternalAgentActionExecutionMode = 'full' | 'guarded' | 'opaque';
export type ExternalAgentActionRiskLevel = 'low' | 'medium' | 'high';

export type ExternalAgentActionDescriptor = {
  actionId: string;
  modId: string;
  sourceType: string;
  description?: string;
  operation: 'read' | 'write';
  socialPrecondition: 'none' | 'human-agent-active';
  executionMode: ExternalAgentActionExecutionMode;
  riskLevel: ExternalAgentActionRiskLevel;
  supportsDryRun: boolean;
  idempotent: boolean;
  requiredCapabilities: string[];
};

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
};

export type ExternalAgentActionExecutionRequest = {
  executionId: string;
  actionId: string;
  phase: 'dry-run' | 'verify' | 'commit';
  input: JsonObject;
  context: {
    principalId: string;
    principalType: 'external-agent';
    mode: 'delegated' | 'autonomous';
    subjectAccountId: string;
    issuer?: string;
    authTokenId?: string;
    traceId: string;
    userAccountId?: string;
    externalAccountId?: string;
    delegationChain?: string[];
  };
  idempotencyKey?: string;
  verifyTicket?: string;
};

export type ExternalAgentActionExecutionCompletion = {
  executionId: string;
  ok: boolean;
  reasonCode: string;
  actionHint: string;
  traceId: string;
  auditId?: string;
  output?: JsonObject;
  executionMode: ExternalAgentActionExecutionMode;
  warnings?: string[];
};
export function parseExternalAgentActionDescriptors(value: unknown): ExternalAgentActionDescriptor[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = assertRecord(item, 'external_agent_sync_action_descriptors returned invalid action descriptor');
    const executionModeRaw = String(record.executionMode || '').trim();
    const riskLevelRaw = String(record.riskLevel || '').trim();
    const executionMode: ExternalAgentActionExecutionMode = (
      executionModeRaw === 'full'
      || executionModeRaw === 'opaque'
    )
      ? executionModeRaw
      : 'guarded';
    const riskLevel: ExternalAgentActionRiskLevel = (
      riskLevelRaw === 'low'
      || riskLevelRaw === 'high'
    )
      ? riskLevelRaw
      : 'medium';
    const requiredCapabilities = Array.isArray(record.requiredCapabilities)
      ? record.requiredCapabilities.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const operationRaw = String(record.operation || '').trim();
    const socialPreconditionRaw = String(record.socialPrecondition || '').trim();
    const operation = operationRaw === 'write' ? 'write' : 'read';
    const socialPrecondition = socialPreconditionRaw === 'human-agent-active'
      ? 'human-agent-active'
      : 'none';
    return {
      actionId: parseRequiredString(record.actionId, 'actionId', 'external-agent action descriptor'),
      modId: parseRequiredString(record.modId, 'modId', 'external-agent action descriptor'),
      sourceType: parseRequiredString(record.sourceType, 'sourceType', 'external-agent action descriptor'),
      description: parseOptionalString(record.description),
      operation,
      socialPrecondition,
      executionMode,
      riskLevel,
      supportsDryRun: Boolean(record.supportsDryRun),
      idempotent: Boolean(record.idempotent),
      requiredCapabilities,
    };
  });
}

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
  };
}

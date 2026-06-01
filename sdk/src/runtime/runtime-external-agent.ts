import { toIsoFromTimestamp } from './helpers.js';
import type {
  ExternalAgentActionScope,
  ExternalAgentGatewayStatusResponse,
  ExternalAgentIssueTokenResponse,
  ExternalAgentTokenRecord as RuntimeExternalAgentTokenRecord,
} from './generated/runtime/v1/external_agent.js';
import type { RuntimeExternalAgentClient } from './types-client-interfaces.js';

export type ExternalAgentTokenMode = 'delegated' | 'autonomous';

export type ExternalAgentIssueTokenProjection = {
  token: string;
  tokenId: string;
  principalId?: string;
  mode?: ExternalAgentTokenMode;
  subjectAccountId?: string;
  actions?: string[];
  scopes?: ExternalAgentActionScopeProjection[];
  issuedAt?: string;
  expiresAt: string;
  revokedAt?: string;
  issuer: string;
};

export type ExternalAgentActionScopeProjection = {
  actionId: string;
  ops: string[];
};

export type ExternalAgentTokenLedgerRecord = {
  tokenId: string;
  principalId: string;
  mode: ExternalAgentTokenMode;
  subjectAccountId: string;
  actions: string[];
  scopes: ExternalAgentActionScopeProjection[];
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
  issuer: string;
};

export type ExternalAgentGatewayStatusProjection = {
  enabled: boolean;
  bindAddress: string;
  issuer: string;
  actionCount: number;
  status?: string;
  reasonCode?: string;
};

export type ExternalAgentIssueTokenPayload = {
  principalId: string;
  mode: ExternalAgentTokenMode;
  subjectAccountId: string;
  actions: string[];
  scopes?: ExternalAgentActionScopeProjection[];
  ttlSeconds?: number;
};

export type RuntimeExternalAgentAccessSurface = {
  issueToken(payload: ExternalAgentIssueTokenPayload): Promise<ExternalAgentIssueTokenProjection>;
  revokeToken(tokenId: string): Promise<void>;
  listTokens(): Promise<ExternalAgentTokenLedgerRecord[]>;
  getGatewayStatus(): Promise<ExternalAgentGatewayStatusProjection>;
};

export type HostRuntimeExternalAgentAccessSurfaceOptions = {
  getRuntime: () => {
    externalAgent: Pick<
      RuntimeExternalAgentClient,
      'issueToken' | 'revokeToken' | 'listTokens' | 'getGatewayStatus'
    >;
  };
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeMode(value: unknown): ExternalAgentTokenMode | undefined {
  const normalized = normalizeText(value);
  return normalized === 'delegated' || normalized === 'autonomous'
    ? normalized
    : undefined;
}

function requiredText(value: unknown, field: string): string {
  const text = normalizeText(value);
  if (!text) {
    throw new Error(`EXTERNAL_AGENT_TOKEN_LEDGER_FIELD_INVALID:${field}`);
  }
  return text;
}

function requiredTextArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`EXTERNAL_AGENT_TOKEN_LEDGER_FIELD_INVALID:${field}`);
  }
  return value.map((entry, index) => requiredText(entry, `${field}[${index}]`));
}

function projectExternalAgentActionScope(
  value: ExternalAgentActionScope | undefined,
): ExternalAgentActionScopeProjection | null {
  const actionId = normalizeText(value?.actionId);
  if (!actionId) {
    return null;
  }
  return {
    actionId,
    ops: Array.isArray(value?.ops)
      ? value.ops.map((entry) => normalizeText(entry)).filter(Boolean)
      : [],
  };
}

function projectRequiredExternalAgentActionScope(
  value: ExternalAgentActionScope | undefined,
  index: number,
): ExternalAgentActionScopeProjection {
  if (!value || typeof value !== 'object') {
    throw new Error(`EXTERNAL_AGENT_TOKEN_LEDGER_SCOPE_INVALID:${index}`);
  }
  return {
    actionId: requiredText(value.actionId, `scopes[${index}].actionId`),
    ops: requiredTextArray(value.ops, `scopes[${index}].ops`),
  };
}

export function projectExternalAgentIssueTokenResult(
  result: ExternalAgentIssueTokenResponse,
): ExternalAgentIssueTokenProjection {
  const revokedAt = normalizeText(result.revokedAt);
  return {
    token: normalizeText(result.token),
    tokenId: normalizeText(result.tokenId),
    principalId: normalizeText(result.principalId) || undefined,
    mode: normalizeMode(result.mode),
    subjectAccountId: normalizeText(result.subjectAccountId) || undefined,
    actions: Array.isArray(result.actions)
      ? result.actions.map((item) => normalizeText(item)).filter(Boolean)
      : undefined,
    scopes: Array.isArray(result.scopes)
      ? result.scopes
        .map((item) => projectExternalAgentActionScope(item))
        .filter((scope): scope is ExternalAgentActionScopeProjection => Boolean(scope))
      : undefined,
    issuedAt: toIsoFromTimestamp(result.issuedAt) || undefined,
    expiresAt: toIsoFromTimestamp(result.expiresAt) || '',
    ...(revokedAt ? { revokedAt } : {}),
    issuer: normalizeText(result.issuer),
  };
}

export function parseExternalAgentTokenLedgerRecord(
  value: RuntimeExternalAgentTokenRecord,
  index = 0,
): ExternalAgentTokenLedgerRecord {
  if (!value || typeof value !== 'object') {
    throw new Error(`EXTERNAL_AGENT_TOKEN_LEDGER_RECORD_INVALID:${index}`);
  }
  const mode = normalizeMode(value.mode);
  if (!mode) {
    throw new Error(`EXTERNAL_AGENT_TOKEN_LEDGER_FIELD_INVALID:tokens[${index}].mode`);
  }
  if (!Array.isArray(value.scopes)) {
    throw new Error(`EXTERNAL_AGENT_TOKEN_LEDGER_FIELD_INVALID:tokens[${index}].scopes`);
  }
  return {
    tokenId: requiredText(value.tokenId, `tokens[${index}].tokenId`),
    principalId: requiredText(value.principalId, `tokens[${index}].principalId`),
    mode,
    subjectAccountId: requiredText(value.subjectAccountId, `tokens[${index}].subjectAccountId`),
    actions: requiredTextArray(value.actions, `tokens[${index}].actions`),
    scopes: value.scopes.map((entry, scopeIndex) => projectRequiredExternalAgentActionScope(entry, scopeIndex)),
    issuedAt: requiredText(toIsoFromTimestamp(value.issuedAt), `tokens[${index}].issuedAt`),
    expiresAt: requiredText(toIsoFromTimestamp(value.expiresAt), `tokens[${index}].expiresAt`),
    revokedAt: toIsoFromTimestamp(value.revokedAt) || undefined,
    issuer: requiredText(value.issuer, `tokens[${index}].issuer`),
  };
}

export function projectExternalAgentTokenLedger(
  tokens: RuntimeExternalAgentTokenRecord[],
): ExternalAgentTokenLedgerRecord[] {
  if (!Array.isArray(tokens)) {
    throw new Error('EXTERNAL_AGENT_TOKEN_LEDGER_INVALID_RESPONSE');
  }
  return tokens.map((item, index) => parseExternalAgentTokenLedgerRecord(item, index));
}

export function projectExternalAgentGatewayStatus(
  result: ExternalAgentGatewayStatusResponse,
): ExternalAgentGatewayStatusProjection {
  const status = normalizeText(result.status);
  const reasonCode = normalizeText(result.reasonCode);
  return {
    enabled: Boolean(result.enabled),
    bindAddress: normalizeText(result.bindAddress),
    issuer: normalizeText(result.issuer),
    actionCount: Number.isFinite(Number(result.actionCount)) ? Number(result.actionCount) : 0,
    ...(status ? { status } : {}),
    ...(reasonCode ? { reasonCode } : {}),
  };
}

export function createHostRuntimeExternalAgentAccessSurface(
  options: HostRuntimeExternalAgentAccessSurfaceOptions,
): RuntimeExternalAgentAccessSurface {
  const getExternalAgent = () => options.getRuntime().externalAgent;
  return {
    async issueToken(payload) {
      const result = await getExternalAgent().issueToken({
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
      return projectExternalAgentIssueTokenResult(result);
    },
    async revokeToken(tokenId) {
      await getExternalAgent().revokeToken({ tokenId });
    },
    async listTokens() {
      const result = await getExternalAgent().listTokens({
        pageSize: 0,
        pageToken: '',
        includeRevoked: false,
      });
      return projectExternalAgentTokenLedger(result.tokens);
    },
    async getGatewayStatus() {
      const result = await getExternalAgent().getGatewayStatus({});
      return projectExternalAgentGatewayStatus(result);
    },
  };
}

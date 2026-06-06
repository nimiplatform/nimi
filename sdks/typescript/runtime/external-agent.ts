import {
  type ExternalAgentActionScope,
  type ExternalAgentGatewayStatusResponse,
  type ExternalAgentIssueTokenResponse,
  type ExternalAgentTokenRecord as RuntimeExternalAgentTokenRecord,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import { toNimiRuntimeIsoFromTimestamp } from './runtime-agent-values';

export type NimiExternalAgentTokenMode = 'delegated' | 'autonomous';

export interface NimiExternalAgentIssueTokenProjection {
  readonly token: string;
  readonly tokenId: string;
  readonly principalId?: string;
  readonly mode?: NimiExternalAgentTokenMode;
  readonly subjectAccountId?: string;
  readonly actions?: readonly string[];
  readonly scopes?: readonly NimiExternalAgentActionScopeProjection[];
  readonly issuedAt?: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly issuer: string;
}

export interface NimiExternalAgentActionScopeProjection {
  readonly actionId: string;
  readonly ops: readonly string[];
}

export interface NimiExternalAgentTokenLedgerRecord {
  readonly tokenId: string;
  readonly principalId: string;
  readonly mode: NimiExternalAgentTokenMode;
  readonly subjectAccountId: string;
  readonly actions: readonly string[];
  readonly scopes: readonly NimiExternalAgentActionScopeProjection[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly issuer: string;
}

export interface NimiExternalAgentGatewayStatusProjection {
  readonly enabled: boolean;
  readonly bindAddress: string;
  readonly issuer: string;
  readonly actionCount: number;
  readonly status?: string;
  readonly reasonCode?: string;
}

export interface NimiExternalAgentIssueTokenPayload {
  readonly principalId: string;
  readonly mode: NimiExternalAgentTokenMode;
  readonly subjectAccountId: string;
  readonly actions: readonly string[];
  readonly scopes?: readonly NimiExternalAgentActionScopeProjection[];
  readonly ttlSeconds?: number;
}

export interface NimiRuntimeExternalAgentAccessSurface {
  issueToken(payload: NimiExternalAgentIssueTokenPayload): Promise<NimiExternalAgentIssueTokenProjection>;
  revokeToken(tokenId: string): Promise<void>;
  listTokens(): Promise<readonly NimiExternalAgentTokenLedgerRecord[]>;
  getGatewayStatus(): Promise<NimiExternalAgentGatewayStatusProjection>;
}

export interface NimiRuntimeExternalAgentClient {
  getExternalAgentGatewayStatus(
    request: Record<string, never>,
    options?: RuntimeTypedCallOptions,
  ): Promise<ExternalAgentGatewayStatusResponse>;
  issueExternalAgentToken(
    request: {
      readonly principalId: string;
      readonly mode: string;
      readonly subjectAccountId: string;
      readonly actions: string[];
      readonly scopes: ExternalAgentActionScope[];
      readonly ttlSeconds: number;
    },
    options?: RuntimeTypedCallOptions,
  ): Promise<ExternalAgentIssueTokenResponse>;
  revokeExternalAgentToken(
    request: { readonly tokenId: string },
    options?: RuntimeTypedCallOptions,
  ): Promise<unknown>;
  listExternalAgentTokens(
    request: { readonly pageSize: number; readonly pageToken: string; readonly includeRevoked: boolean },
    options?: RuntimeTypedCallOptions,
  ): Promise<{ readonly tokens: RuntimeExternalAgentTokenRecord[] }>;
}

export interface NimiRuntimeExternalAgentAccessSurfaceOptions {
  readonly getExternalAgents: () => NimiRuntimeExternalAgentClient;
  readonly callOptions?: RuntimeTypedCallOptions;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeMode(value: unknown): NimiExternalAgentTokenMode | undefined {
  const normalized = normalizeText(value);
  return normalized === 'delegated' || normalized === 'autonomous'
    ? normalized
    : undefined;
}

function invalidExternalAgentRecord(message: string, reasonCode: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint,
    source: 'runtime',
  });
}

function requiredText(value: unknown, field: string): string {
  const text = normalizeText(value);
  if (!text) {
    invalidExternalAgentRecord(
      `Runtime external agent token ledger field is invalid: ${field}`,
      'SDK_RUNTIME_EXTERNAL_AGENT_TOKEN_LEDGER_INVALID',
      'check_runtime_external_agent_response',
    );
  }
  return text;
}

function requiredTextArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    invalidExternalAgentRecord(
      `Runtime external agent token ledger field is invalid: ${field}`,
      'SDK_RUNTIME_EXTERNAL_AGENT_TOKEN_LEDGER_INVALID',
      'check_runtime_external_agent_response',
    );
  }
  return value.map((entry, index) => requiredText(entry, `${field}[${index}]`));
}

function projectExternalAgentActionScope(
  value: ExternalAgentActionScope | undefined,
): NimiExternalAgentActionScopeProjection | null {
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
): NimiExternalAgentActionScopeProjection {
  if (!value || typeof value !== 'object') {
    invalidExternalAgentRecord(
      `Runtime external agent token ledger scope is invalid: ${index}`,
      'SDK_RUNTIME_EXTERNAL_AGENT_TOKEN_LEDGER_INVALID',
      'check_runtime_external_agent_response',
    );
  }
  return {
    actionId: requiredText(value.actionId, `scopes[${index}].actionId`),
    ops: requiredTextArray(value.ops, `scopes[${index}].ops`),
  };
}

export function projectNimiExternalAgentIssueTokenResult(
  result: ExternalAgentIssueTokenResponse,
): NimiExternalAgentIssueTokenProjection {
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
        .filter((scope): scope is NimiExternalAgentActionScopeProjection => Boolean(scope))
      : undefined,
    issuedAt: toNimiRuntimeIsoFromTimestamp(result.issuedAt) || undefined,
    expiresAt: toNimiRuntimeIsoFromTimestamp(result.expiresAt) || '',
    ...(revokedAt ? { revokedAt } : {}),
    issuer: normalizeText(result.issuer),
  };
}

export function parseNimiExternalAgentTokenLedgerRecord(
  value: RuntimeExternalAgentTokenRecord,
  index = 0,
): NimiExternalAgentTokenLedgerRecord {
  if (!value || typeof value !== 'object') {
    invalidExternalAgentRecord(
      `Runtime external agent token ledger record is invalid: ${index}`,
      'SDK_RUNTIME_EXTERNAL_AGENT_TOKEN_LEDGER_INVALID',
      'check_runtime_external_agent_response',
    );
  }
  const mode = normalizeMode(value.mode);
  if (!mode) {
    invalidExternalAgentRecord(
      `Runtime external agent token ledger mode is invalid: tokens[${index}].mode`,
      'SDK_RUNTIME_EXTERNAL_AGENT_TOKEN_LEDGER_INVALID',
      'check_runtime_external_agent_response',
    );
  }
  if (!Array.isArray(value.scopes)) {
    invalidExternalAgentRecord(
      `Runtime external agent token ledger scopes are invalid: tokens[${index}].scopes`,
      'SDK_RUNTIME_EXTERNAL_AGENT_TOKEN_LEDGER_INVALID',
      'check_runtime_external_agent_response',
    );
  }
  return {
    tokenId: requiredText(value.tokenId, `tokens[${index}].tokenId`),
    principalId: requiredText(value.principalId, `tokens[${index}].principalId`),
    mode,
    subjectAccountId: requiredText(value.subjectAccountId, `tokens[${index}].subjectAccountId`),
    actions: requiredTextArray(value.actions, `tokens[${index}].actions`),
    scopes: value.scopes.map((entry, scopeIndex) => projectRequiredExternalAgentActionScope(entry, scopeIndex)),
    issuedAt: requiredText(toNimiRuntimeIsoFromTimestamp(value.issuedAt), `tokens[${index}].issuedAt`),
    expiresAt: requiredText(toNimiRuntimeIsoFromTimestamp(value.expiresAt), `tokens[${index}].expiresAt`),
    revokedAt: toNimiRuntimeIsoFromTimestamp(value.revokedAt) || undefined,
    issuer: requiredText(value.issuer, `tokens[${index}].issuer`),
  };
}

export function projectNimiExternalAgentTokenLedger(
  tokens: readonly RuntimeExternalAgentTokenRecord[],
): readonly NimiExternalAgentTokenLedgerRecord[] {
  if (!Array.isArray(tokens)) {
    invalidExternalAgentRecord(
      'Runtime external agent token ledger response is invalid.',
      'SDK_RUNTIME_EXTERNAL_AGENT_TOKEN_LEDGER_INVALID',
      'check_runtime_external_agent_response',
    );
  }
  return tokens.map((item, index) => parseNimiExternalAgentTokenLedgerRecord(item, index));
}

export function projectNimiExternalAgentGatewayStatus(
  result: ExternalAgentGatewayStatusResponse,
): NimiExternalAgentGatewayStatusProjection {
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

export function createNimiRuntimeExternalAgentAccessSurface(
  options: NimiRuntimeExternalAgentAccessSurfaceOptions,
): NimiRuntimeExternalAgentAccessSurface {
  const getExternalAgents = () => options.getExternalAgents();
  const callOptions = () => options.callOptions || {};
  return {
    async issueToken(payload) {
      const result = await getExternalAgents().issueExternalAgentToken({
        principalId: normalizeText(payload.principalId),
        mode: payload.mode,
        subjectAccountId: normalizeText(payload.subjectAccountId),
        actions: payload.actions.map((item) => normalizeText(item)).filter(Boolean),
        scopes: (payload.scopes || []).map((scope) => ({
          actionId: normalizeText(scope.actionId),
          ops: scope.ops.map((item) => normalizeText(item)).filter(Boolean),
        })),
        ttlSeconds: Number.isInteger(payload.ttlSeconds) && Number(payload.ttlSeconds) > 0
          ? Number(payload.ttlSeconds)
          : 0,
      }, callOptions());
      return projectNimiExternalAgentIssueTokenResult(result);
    },
    async revokeToken(tokenId) {
      await getExternalAgents().revokeExternalAgentToken({ tokenId: normalizeText(tokenId) }, callOptions());
    },
    async listTokens() {
      const result = await getExternalAgents().listExternalAgentTokens({
        pageSize: 0,
        pageToken: '',
        includeRevoked: false,
      }, callOptions());
      return projectNimiExternalAgentTokenLedger(result.tokens);
    },
    async getGatewayStatus() {
      const result = await getExternalAgents().getExternalAgentGatewayStatus({}, callOptions());
      return projectNimiExternalAgentGatewayStatus(result);
    },
  };
}

import { tauriInvoke, hasTauriInvoke } from '@runtime/llm-adapter/tauri-bridge';

export type ExternalAgentActionDescriptor = {
  actionId: string;
  modId: string;
  sourceType: string;
  description?: string;
  operation: 'read' | 'write';
  socialPrecondition: 'none' | 'human-agent-active';
  executionMode: 'full' | 'guarded' | 'opaque';
  riskLevel: 'low' | 'medium' | 'high';
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

export type ExternalAgentActionExecutionRequest = {
  executionId: string;
  actionId: string;
  phase: 'dry-run' | 'verify' | 'commit';
  input: Record<string, unknown>;
  context: {
    principalId: string;
    principalType: 'external-agent';
    mode: 'delegated' | 'autonomous';
    subjectAccountId: string;
    issuer?: string;
    authTokenId?: string;
    bridgeExecutionId?: string;
    traceId: string;
    userAccountId?: string;
    externalAccountId?: string;
    delegationChain?: string[];
  };
  idempotencyKey?: string;
  verifyTicket?: string;
};

let actionBridgeStop: (() => void) | null = null;

function asString(value: unknown): string {
  return String(value || '').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function syncActionDescriptors(): Promise<void> {
  await Promise.resolve();
}

export async function startExternalAgentActionBridge(): Promise<void> {
  stopExternalAgentActionBridge();
  await Promise.resolve();
}

export function stopExternalAgentActionBridge(): void {
  if (actionBridgeStop) {
    actionBridgeStop();
    actionBridgeStop = null;
  }
}

export async function resyncExternalAgentActionDescriptors(): Promise<void> {
  await syncActionDescriptors();
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
    return [];
  }
  return result.map((item) => {
    const record = asRecord(item);
    const modeRaw = asString(record.mode);
    const mode: 'delegated' | 'autonomous' = modeRaw === 'autonomous' ? 'autonomous' : 'delegated';
    return {
      tokenId: asString(record.tokenId),
      principalId: asString(record.principalId),
      mode,
      subjectAccountId: asString(record.subjectAccountId),
      actions: Array.isArray(record.actions)
        ? record.actions.map((entry) => asString(entry)).filter(Boolean)
        : [],
      scopes: Array.isArray(record.scopes)
        ? record.scopes.map((entry) => {
          const scope = asRecord(entry);
          return {
            actionId: asString(scope.actionId),
            ops: Array.isArray(scope.ops) ? scope.ops.map((op) => asString(op)).filter(Boolean) : [],
          };
        }).filter((scope) => scope.actionId)
        : [],
      issuedAt: asString(record.issuedAt),
      expiresAt: asString(record.expiresAt),
      revokedAt: asString(record.revokedAt) || undefined,
      issuer: asString(record.issuer),
    };
  }).filter((item) => item.tokenId && item.principalId && item.subjectAccountId && item.issuedAt && item.expiresAt && item.issuer);
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

import { tauriInvoke, hasTauriInvoke } from '@runtime/llm-adapter/tauri-bridge';
import { listenTauri } from '@runtime/tauri-api';
import { getRuntimeHookRuntime } from '@runtime/mod';
import { ReasonCode } from '@nimiplatform/sdk/types';

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

type TauriEventUnsubscribe = () => void;
type TauriEventListen = (
  eventName: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<TauriEventUnsubscribe | undefined> | TauriEventUnsubscribe | undefined;

let syncedActionHash = '';
let actionBridgeStarted = false;
let actionBridgeStop: (() => void) | null = null;
let actionRegistrySubscriptionStop: (() => void) | null = null;
let actionRegistryResyncQueued = false;

const EXTERNAL_AGENT_ACTION_REQUEST_EVENT = 'external-agent://action-request';

function asString(value: unknown): string {
  return String(value || '').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseActionPhase(value: unknown): ExternalAgentActionExecutionRequest['phase'] {
  const phase = asString(value);
  if (phase === 'dry-run' || phase === 'verify' || phase === 'commit') {
    return phase;
  }
  throw new Error('ACTION_INPUT_INVALID: external agent action phase must be explicit');
}

function stableActionHash(actions: ExternalAgentActionDescriptor[]): string {
  return JSON.stringify(actions
    .map((item) => ({
      actionId: item.actionId,
      modId: item.modId,
      operation: item.operation,
      socialPrecondition: item.socialPrecondition,
      executionMode: item.executionMode,
      riskLevel: item.riskLevel,
      supportsDryRun: item.supportsDryRun,
      idempotent: item.idempotent,
      requiredCapabilities: item.requiredCapabilities,
    }))
    .sort((left, right) => left.actionId.localeCompare(right.actionId)));
}

function queueActionDescriptorResync(): void {
  if (actionRegistryResyncQueued) return;
  actionRegistryResyncQueued = true;
  queueMicrotask(() => {
    actionRegistryResyncQueued = false;
    void syncActionDescriptors().catch(() => undefined);
  });
}

function readGlobalTauriEventListen(): TauriEventListen | null {
  if (!hasTauriInvoke()) {
    return null;
  }
  return listenTauri;
}

function parseExecutionRequest(value: unknown): ExternalAgentActionExecutionRequest {
  const root = asRecord(value);
  const context = asRecord(root.context);
  const mode = asString(context.mode) === 'autonomous' ? 'autonomous' : 'delegated';
  return {
    executionId: asString(root.executionId),
    actionId: asString(root.actionId),
    phase: parseActionPhase(root.phase),
    input: asRecord(root.input),
    context: {
      principalId: asString(context.principalId),
      principalType: 'external-agent',
      mode,
      subjectAccountId: asString(context.subjectAccountId),
      issuer: asString(context.issuer) || undefined,
      authTokenId: asString(context.authTokenId) || undefined,
      bridgeExecutionId: asString(root.executionId) || undefined,
      traceId: asString(context.traceId),
      userAccountId: asString(context.userAccountId) || undefined,
      externalAccountId: asString(context.externalAccountId) || undefined,
      delegationChain: Array.isArray(context.delegationChain)
        ? context.delegationChain.map((item) => asString(item)).filter(Boolean)
        : undefined,
    },
    idempotencyKey: asString(root.idempotencyKey) || undefined,
    verifyTicket: asString(root.verifyTicket) || undefined,
  };
}

function invalidExecutionRequestCompletion(value: unknown, error: unknown) {
  const root = asRecord(value);
  const context = asRecord(root.context);
  const executionId = asString(root.executionId);
  const traceId = asString(context.traceId) || executionId;
  return {
    executionId,
    ok: false,
    reasonCode: ReasonCode.ACTION_INPUT_INVALID,
    actionHint: 'fix_input',
    traceId,
    executionMode: 'guarded' as const,
    output: {
      error: error instanceof Error ? error.message : String(error || 'Invalid external agent action request'),
    },
  };
}

async function syncActionDescriptors(): Promise<void> {
  if (!hasTauriInvoke()) return;
  const hookRuntime = getRuntimeHookRuntime();
  const descriptors = hookRuntime.discoverActions({ includeOpaque: true });
  const normalized: ExternalAgentActionDescriptor[] = descriptors.map((descriptor) => ({
    actionId: descriptor.actionId,
    modId: descriptor.modId,
    sourceType: descriptor.sourceType,
    description: descriptor.description,
    operation: descriptor.operation,
    socialPrecondition: descriptor.socialPrecondition || 'none',
    executionMode: descriptor.executionMode,
    riskLevel: descriptor.riskLevel,
    supportsDryRun: descriptor.supportsDryRun,
    idempotent: descriptor.idempotent,
    requiredCapabilities: descriptor.requiredCapabilities,
  }));
  const hash = stableActionHash(normalized);
  if (hash === syncedActionHash) return;
  await tauriInvoke('external_agent_sync_action_descriptors', {
    payload: {
      descriptors: normalized,
    },
  });
  syncedActionHash = hash;
}

async function completeExecution(payload: {
  executionId: string;
  ok: boolean;
  reasonCode: string;
  actionHint: string;
  traceId: string;
  auditId?: string;
  output?: Record<string, unknown>;
  executionMode: 'full' | 'guarded' | 'opaque';
  warnings?: string[];
}): Promise<void> {
  if (!hasTauriInvoke()) return;
  await tauriInvoke('external_agent_complete_execution', { payload });
}

async function executeActionRequest(request: ExternalAgentActionExecutionRequest): Promise<void> {
  const hookRuntime = getRuntimeHookRuntime();
  const payload = {
    actionId: request.actionId,
    input: request.input,
    context: request.context,
    idempotencyKey: request.idempotencyKey,
    verifyTicket: request.verifyTicket,
  };
  const result = request.phase === 'dry-run'
    ? await hookRuntime.dryRunAction(payload)
    : request.phase === 'verify'
      ? await hookRuntime.verifyAction(payload)
      : await hookRuntime.commitAction(payload);
  await completeExecution({
    executionId: request.executionId,
    ok: result.ok,
    reasonCode: result.reasonCode,
    actionHint: result.actionHint,
    traceId: result.traceId,
    auditId: result.auditId,
    output: result.output,
    executionMode: result.executionMode,
    warnings: result.warnings,
  });
}

export async function startExternalAgentActionBridge(): Promise<void> {
  const hookRuntime = getRuntimeHookRuntime();
  if (!actionRegistrySubscriptionStop) {
    actionRegistrySubscriptionStop = hookRuntime.subscribeActionRegistryChanges(() => {
      queueActionDescriptorResync();
    });
  }
  await syncActionDescriptors();
  if (actionBridgeStarted) return;
  const listen = readGlobalTauriEventListen();
  if (!listen) return;

  const unsubscribeResult = await Promise.resolve(
    listen(EXTERNAL_AGENT_ACTION_REQUEST_EVENT, (event) => {
      let request: ExternalAgentActionExecutionRequest;
      try {
        request = parseExecutionRequest(event.payload);
      } catch (error) {
        void completeExecution(invalidExecutionRequestCompletion(event.payload, error));
        return;
      }
      void executeActionRequest(request).catch(async (error) => {
        await completeExecution({
          executionId: request.executionId,
          ok: false,
          reasonCode: ReasonCode.ACTION_EXECUTION_BRIDGE_FAILED,
          actionHint: 'retry',
          traceId: request.context.traceId || request.executionId,
          executionMode: 'guarded',
          output: {
            error: error instanceof Error ? error.message : String(error || ''),
          },
        });
      });
    }),
  );

  actionBridgeStop = typeof unsubscribeResult === 'function' ? unsubscribeResult : null;
  actionBridgeStarted = true;
}

export function stopExternalAgentActionBridge(): void {
  if (actionBridgeStop) {
    actionBridgeStop();
    actionBridgeStop = null;
  }
  if (actionRegistrySubscriptionStop) {
    actionRegistrySubscriptionStop();
    actionRegistrySubscriptionStop = null;
  }
  syncedActionHash = '';
  actionRegistryResyncQueued = false;
  actionBridgeStarted = false;
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
  };
}

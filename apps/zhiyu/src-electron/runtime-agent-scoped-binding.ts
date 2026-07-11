import {
  Runtime,
  issueNimiRuntimeAgentScopedBinding,
  withNimiRuntimeIdempotencyMetadata,
  type NimiRuntimeAccountCaller,
  type RuntimeAccountModule,
} from '@nimiplatform/sdk/runtime';
import {
  AccountSessionState,
} from '@nimiplatform/sdk/runtime/wire-types';
import {
  NimiElectronShellHostError,
  type NimiElectronCommandHandler,
} from '@nimiplatform/kit/shell/electron/main';
import {
  createZhiyuElectronRuntimeAccountCaller,
  createZhiyuElectronRuntimeAppSessionMetadataProvider,
} from './runtime-account-caller.js';

export const ZHIYU_RUNTIME_AGENT_SCOPED_BINDING_COMMAND = 'zhiyu.runtimeAgent.issueScopedBinding';

const delegationScopes = [
  'runtime.agent.delegation.read',
  'runtime.agent.delegation.write',
] as const;
const admittedScopedBindingScopes = new Set<string>([
  ...delegationScopes,
  'runtime.agent.read',
  'runtime.agent.autonomy.write',
  'runtime.agent.turn.read',
  'runtime.agent.turn.write',
]);
const scopedBindingTtlSeconds = 15 * 60;

export interface ZhiyuRuntimeAgentScopedBindingRuntime {
  readonly account: Pick<RuntimeAccountModule, 'getAccountSessionStatus' | 'issueScopedAppBinding'>;
}

export function createZhiyuRuntimeAgentScopedBindingCommandHandler(input: {
  readonly appId: string;
  readonly runtimeEndpoint: string;
  readonly runtime?: ZhiyuRuntimeAgentScopedBindingRuntime;
  readonly accountCaller?: NimiRuntimeAccountCaller;
  readonly appSessionMetadata?: () => Promise<Readonly<Record<string, string>>>;
}): NimiElectronCommandHandler {
  const appId = requireText(input.appId, 'appId');
  const runtimeEndpoint = requireText(input.runtimeEndpoint, 'runtimeEndpoint');
  const ownedRuntime = input.runtime ? null : new Runtime({
    appId,
    transport: { endpoint: runtimeEndpoint },
  });
  const runtime = input.runtime ?? ownedRuntime!;
  const accountCaller = input.accountCaller ?? createZhiyuElectronRuntimeAccountCaller(appId);
  const appSessionMetadata = input.appSessionMetadata
    ?? (ownedRuntime
      ? createZhiyuElectronRuntimeAppSessionMetadataProvider({ appId, auth: ownedRuntime.auth })
      : async () => ({}));
  return async ({ payload }) => {
    const ownerUserId = requireText(payload.ownerUserId, 'ownerUserId');
    const localAgentRef = requireText(payload.localAgentRef, 'localAgentRef');
    const conversationAnchorId = requireText(payload.conversationAnchorId, 'conversationAnchorId');
    const issueRequestId = optionalText(payload.issueRequestId) || createScopedBindingIssueRequestId();
    const scopes = requestedScopedBindingScopes(payload.scopes);
    const metadata = await appSessionMetadata();
    await assertRuntimeAccountMatchesOwner({
      runtime,
      accountCaller,
      ownerUserId,
      metadata,
      idempotencyKey: scopedBindingIdempotencyKey('status', ownerUserId, localAgentRef, conversationAnchorId),
    });
    const issued = await issueNimiRuntimeAgentScopedBinding({
      runtime,
      caller: accountCaller,
      agentId: localAgentRef,
      conversationAnchorId,
      scopes,
      ttlSeconds: scopedBindingTtlSeconds,
      options: withNimiRuntimeIdempotencyMetadata(
        { metadata },
        scopedBindingIdempotencyKey('issue', ownerUserId, localAgentRef, conversationAnchorId, issueRequestId),
      ),
    });
    return {
      scopedBinding: {
        ...issued.scopedBinding,
        bindingSource: 'runtime-account-service',
        expiresAt: isoFromMs(issued.expiresAtMs),
        expiresAtMs: issued.expiresAtMs,
        scopes,
      },
      accountId: ownerUserId,
      reasonCode: 'zhiyu-runtime-agent-scoped-binding-issued',
    };
  };
}

async function assertRuntimeAccountMatchesOwner(input: {
  readonly runtime: ZhiyuRuntimeAgentScopedBindingRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
  readonly ownerUserId: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly idempotencyKey: string;
}): Promise<void> {
  const status = await input.runtime.account.getAccountSessionStatus(
    { caller: input.accountCaller },
    withNimiRuntimeIdempotencyMetadata({ metadata: input.metadata }, input.idempotencyKey),
  );
  const accountId = normalizeText(status.accountProjection?.accountId);
  if (status.state !== AccountSessionState.AUTHENTICATED || accountId !== input.ownerUserId) {
    throw new NimiElectronShellHostError({
      code: 'forbidden-renderer-access',
      message: 'Zhiyu scoped Runtime Agent binding requires the active Runtime account owner.',
      reasonCode: 'zhiyu-runtime-agent-scoped-binding-account-mismatch',
      actionHint: 'refresh_runtime_account_projection',
      details: {
        expectedOwnerUserId: input.ownerUserId,
        actualAccountId: accountId,
      },
    });
  }
}

function requestedScopedBindingScopes(value: unknown): string[] {
  const requested = Array.isArray(value)
    ? [...new Set(value.map(optionalText).filter(Boolean))].sort()
    : [];
  const scopes = requested.length > 0 ? requested : [...delegationScopes];
  for (const scope of scopes) {
    if (!admittedScopedBindingScopes.has(scope)) {
      throw new NimiElectronShellHostError({
        code: 'invalid-payload',
        reasonCode: 'zhiyu-runtime-agent-scoped-binding-scope-unadmitted',
        actionHint: 'request_admitted_runtime_agent_scoped_binding_scope',
        source: 'runtime',
        message: `Zhiyu Runtime Agent scoped binding scope is not admitted: ${scope}`,
        details: { scope },
      });
    }
  }
  return scopes;
}

function scopedBindingIdempotencyKey(
  kind: string,
  ownerUserId: string,
  localAgentRef: string,
  conversationAnchorId: string,
  issueRequestId = '',
): string {
  return [
    'zhiyu-runtime-agent-scoped-binding',
    kind,
    safeIdempotencySegment(ownerUserId),
    hashSegment(localAgentRef),
    hashSegment(conversationAnchorId),
    ...(issueRequestId ? [safeIdempotencySegment(issueRequestId)] : []),
  ].join(':');
}

function createScopedBindingIssueRequestId(): string {
  return `issue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function hashSegment(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function safeIdempotencySegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 80) || 'unknown';
}

function isoFromMs(value: number): string {
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : '';
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: `Zhiyu scoped Runtime Agent binding requires ${field}.`,
      reasonCode: 'zhiyu-runtime-agent-scoped-binding-input-invalid',
      actionHint: `provide_${field}`,
    });
  }
  return normalized;
}

function optionalText(value: unknown): string {
  return normalizeText(value);
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

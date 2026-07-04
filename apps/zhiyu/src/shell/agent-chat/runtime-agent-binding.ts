export interface ZhiyuRuntimeTypedCallOptions {
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface ZhiyuScopedRuntimeBindingAttachment {
  readonly bindingId: string;
  readonly bindingHandle?: string;
  readonly runtimeAppId?: string;
  readonly appInstanceId?: string;
  readonly windowId?: string;
  readonly avatarInstanceId?: string;
  readonly agentId?: string;
  readonly conversationAnchorId?: string;
  readonly worldId?: string;
}

export interface ZhiyuRuntimeAgentHostEquivalenceInput {
  readonly evidenceRef?: string;
  readonly authority?: string;
  readonly failureSemantics?: string;
}

export type ZhiyuRuntimeAgentBindingDecision =
  | {
    readonly kind: 'runtime-issued-scoped-binding';
    readonly scopedBinding: Required<ZhiyuScopedRuntimeBindingAttachment>;
  }
  | {
    readonly kind: 'runtime-sdk-authority-admitted-first-party-electron-host-equivalence';
    readonly evidenceRef: string;
  }
  | {
    readonly kind: 'missing';
    readonly reasonCode: 'ZHIYU_RUNTIME_AGENT_BINDING_REQUIRED';
    readonly actionHint: 'attach_runtime_scoped_binding_or_admitted_host_equivalence';
    readonly message: string;
  };

export type ZhiyuRuntimeAgentScopeRunner = <T>(
  scopes: readonly string[],
  operation: (options: ZhiyuRuntimeTypedCallOptions) => Promise<T>,
) => Promise<T>;

export const withZhiyuRuntimeAgentBindingRequired: ZhiyuRuntimeAgentScopeRunner =
  createZhiyuRuntimeAgentBindingScopeRunner(resolveZhiyuRuntimeAgentBindingDecisionFromHost);

export function resolveZhiyuRuntimeAgentBindingDecision(input: {
  readonly scopedBinding?: ZhiyuScopedRuntimeBindingAttachment | null;
  readonly hostEquivalence?: ZhiyuRuntimeAgentHostEquivalenceInput | null;
} = {}): ZhiyuRuntimeAgentBindingDecision {
  const scopedBinding = normalizeScopedBinding(input.scopedBinding);
  if (scopedBinding) {
    return {
      kind: 'runtime-issued-scoped-binding',
      scopedBinding,
    };
  }

  const hostEquivalence = normalizeHostEquivalence(input.hostEquivalence);
  if (hostEquivalence) {
    return {
      kind: 'runtime-sdk-authority-admitted-first-party-electron-host-equivalence',
      evidenceRef: hostEquivalence.evidenceRef,
    };
  }

  return missingBindingDecision();
}

export function resolveZhiyuRuntimeAgentBindingDecisionFromHost(): ZhiyuRuntimeAgentBindingDecision {
  const host = globalThis as typeof globalThis & {
    readonly window?: unknown;
    readonly __nimiZhiyuRuntimeAgentBinding?: {
      readonly scopedBinding?: ZhiyuScopedRuntimeBindingAttachment | null;
      readonly hostEquivalence?: ZhiyuRuntimeAgentHostEquivalenceInput | null;
    };
  };
  const windowBinding = isRecord(host.window)
    ? (host.window as { readonly __nimiZhiyuRuntimeAgentBinding?: {
      readonly scopedBinding?: ZhiyuScopedRuntimeBindingAttachment | null;
      readonly hostEquivalence?: ZhiyuRuntimeAgentHostEquivalenceInput | null;
    } }).__nimiZhiyuRuntimeAgentBinding
    : undefined;
  return resolveZhiyuRuntimeAgentBindingDecision(host.__nimiZhiyuRuntimeAgentBinding ?? windowBinding ?? {});
}

export function scopedBindingForRuntimeAgentRequest(
  decision: ZhiyuRuntimeAgentBindingDecision,
): Required<ZhiyuScopedRuntimeBindingAttachment> | undefined {
  return decision.kind === 'runtime-issued-scoped-binding' ? decision.scopedBinding : undefined;
}

export async function withZhiyuRuntimeAgentBindingScopes<T>(
  decision: ZhiyuRuntimeAgentBindingDecision,
  _scopes: readonly string[],
  operation: (options: ZhiyuRuntimeTypedCallOptions) => Promise<T>,
): Promise<T> {
  assertZhiyuRuntimeAgentBindingDecision(decision);
  return operation(callOptionsForBindingDecision(decision));
}

export function createZhiyuRuntimeAgentBindingScopeRunner(
  resolveDecision: () => ZhiyuRuntimeAgentBindingDecision | Promise<ZhiyuRuntimeAgentBindingDecision>,
): ZhiyuRuntimeAgentScopeRunner {
  return async (scopes, operation) => {
    const decision = await resolveDecision();
    return withZhiyuRuntimeAgentBindingScopes(decision, scopes, operation);
  };
}

export function assertZhiyuRuntimeAgentBindingDecision(
  decision: ZhiyuRuntimeAgentBindingDecision,
): asserts decision is Exclude<ZhiyuRuntimeAgentBindingDecision, { readonly kind: 'missing' }> {
  if (decision.kind !== 'missing') {
    return;
  }
  const error = new Error(decision.message) as Error & {
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
  };
  Object.assign(error, {
    reasonCode: decision.reasonCode,
    actionHint: decision.actionHint,
    source: 'runtime',
  });
  throw error;
}

function callOptionsForBindingDecision(
  decision: Exclude<ZhiyuRuntimeAgentBindingDecision, { readonly kind: 'missing' }>,
): ZhiyuRuntimeTypedCallOptions {
  if (decision.kind === 'runtime-issued-scoped-binding') {
    return {
      metadata: {
        'x-nimi-runtime-scoped-binding-id': decision.scopedBinding.bindingId,
      },
    };
  }
  return {
    metadata: {
      'x-nimi-runtime-host-equivalence': decision.evidenceRef,
    },
  };
}

function normalizeScopedBinding(
  input: ZhiyuScopedRuntimeBindingAttachment | null | undefined,
): Required<ZhiyuScopedRuntimeBindingAttachment> | null {
  const bindingId = normalizeText(input?.bindingId);
  if (!bindingId) {
    return null;
  }
  return {
    bindingId,
    bindingHandle: normalizeText(input?.bindingHandle),
    runtimeAppId: normalizeText(input?.runtimeAppId) || 'runtime.agent',
    appInstanceId: normalizeText(input?.appInstanceId),
    windowId: normalizeText(input?.windowId),
    avatarInstanceId: normalizeText(input?.avatarInstanceId),
    agentId: normalizeText(input?.agentId),
    conversationAnchorId: normalizeText(input?.conversationAnchorId),
    worldId: normalizeText(input?.worldId),
  };
}

function normalizeHostEquivalence(
  input: ZhiyuRuntimeAgentHostEquivalenceInput | null | undefined,
): { readonly evidenceRef: string } | null {
  const evidenceRef = normalizeText(input?.evidenceRef);
  if (
    normalizeText(input?.authority) !== 'runtime-sdk'
    || normalizeText(input?.failureSemantics) !== 'fail-closed'
    || !evidenceRef.startsWith('runtime-sdk-authority:')
  ) {
    return null;
  }
  return { evidenceRef };
}

function missingBindingDecision(): ZhiyuRuntimeAgentBindingDecision {
  return {
    kind: 'missing',
    reasonCode: 'ZHIYU_RUNTIME_AGENT_BINDING_REQUIRED',
    actionHint: 'attach_runtime_scoped_binding_or_admitted_host_equivalence',
    message: 'Zhiyu Runtime Agent consumption requires a Runtime-issued scoped binding or Runtime/SDK-authority-admitted first-party Electron host equivalence.',
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

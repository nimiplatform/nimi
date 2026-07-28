export interface ZhiyuRuntimeTypedCallOptions {
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface ZhiyuProtectedLocalAppCarrierInput {
  readonly kind?: string;
}

export interface ZhiyuRuntimeAgentAccessHost {
  readonly localAppCarrier?: ZhiyuProtectedLocalAppCarrierInput | null;
}

export type ZhiyuRuntimeAgentAccessDecision =
  | {
    readonly kind: 'local-app-carrier';
  }
  | {
    readonly kind: 'missing';
    readonly reasonCode: 'ZHIYU_RUNTIME_AGENT_OPERATION_CONTEXT_REQUIRED';
    readonly actionHint: 'attach_protected_local_app_carrier';
    readonly message: string;
  };

export type ZhiyuRuntimeAgentScopeRunner = <T>(
  scopes: readonly string[],
  operation: (options: ZhiyuRuntimeTypedCallOptions) => Promise<T>,
) => Promise<T>;

export const withZhiyuRuntimeAgentAccessRequired: ZhiyuRuntimeAgentScopeRunner =
  createZhiyuRuntimeAgentAccessScopeRunner(resolveZhiyuRuntimeAgentAccessDecisionFromHost);

export function resolveZhiyuRuntimeAgentAccessDecision(input: {
  readonly localAppCarrier?: ZhiyuProtectedLocalAppCarrierInput | null;
} = {}): ZhiyuRuntimeAgentAccessDecision {
  if (isProtectedLocalAppCarrier(input.localAppCarrier)) {
    return { kind: 'local-app-carrier' };
  }
  return missingAccessDecision();
}

export function resolveZhiyuRuntimeAgentAccessDecisionFromHost(): ZhiyuRuntimeAgentAccessDecision {
  const host = globalThis as typeof globalThis & {
    readonly window?: unknown;
    readonly __nimiZhiyuRuntimeAgentAccess?: ZhiyuRuntimeAgentAccessHost;
  };
  const windowAccess = isRecord(host.window)
    ? (host.window as {
      readonly __nimiZhiyuRuntimeAgentAccess?: ZhiyuRuntimeAgentAccessHost;
    }).__nimiZhiyuRuntimeAgentAccess
    : undefined;
  return resolveZhiyuRuntimeAgentAccessDecision(
    readAccessHost(host.__nimiZhiyuRuntimeAgentAccess)
      ?? readAccessHost(windowAccess)
      ?? {},
  );
}

export async function withZhiyuRuntimeAgentAccess<T>(
  decision: ZhiyuRuntimeAgentAccessDecision,
  operation: (options: ZhiyuRuntimeTypedCallOptions) => Promise<T>,
): Promise<T> {
  assertZhiyuRuntimeAgentAccessDecision(decision);
  return operation({});
}

export function createZhiyuRuntimeAgentAccessScopeRunner(
  resolveDecision: () => ZhiyuRuntimeAgentAccessDecision | Promise<ZhiyuRuntimeAgentAccessDecision>,
): ZhiyuRuntimeAgentScopeRunner {
  return async (_scopes, operation) => {
    const decision = await resolveDecision();
    return withZhiyuRuntimeAgentAccess(decision, operation);
  };
}

export function assertZhiyuRuntimeAgentAccessDecision(
  decision: ZhiyuRuntimeAgentAccessDecision,
): asserts decision is { readonly kind: 'local-app-carrier' } {
  if (decision.kind === 'local-app-carrier') {
    return;
  }
  throw Object.assign(new Error(decision.message), {
    reasonCode: decision.reasonCode,
    actionHint: decision.actionHint,
    source: 'runtime',
  });
}

function readAccessHost(
  input: ZhiyuRuntimeAgentAccessHost | null | undefined,
): ZhiyuRuntimeAgentAccessHost | null {
  return isRecord(input) ? input as ZhiyuRuntimeAgentAccessHost : null;
}

function isProtectedLocalAppCarrier(
  input: ZhiyuProtectedLocalAppCarrierInput | null | undefined,
): boolean {
  return normalizeText(input?.kind) === 'protected-local-app-carrier';
}

function missingAccessDecision(): ZhiyuRuntimeAgentAccessDecision {
  return {
    kind: 'missing',
    reasonCode: 'ZHIYU_RUNTIME_AGENT_OPERATION_CONTEXT_REQUIRED',
    actionHint: 'attach_protected_local_app_carrier',
    message: 'Zhiyu Runtime Agent consumption requires the host-bound protected local-app carrier.',
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

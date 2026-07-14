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

export type ZhiyuNormalizedScopedRuntimeBindingAttachment = {
  readonly bindingId: string;
  readonly bindingHandle: string;
  readonly runtimeAppId: string;
  readonly appInstanceId: string;
  readonly windowId: string;
  readonly avatarInstanceId: string;
  readonly agentId: string;
  readonly conversationAnchorId: string;
  readonly worldId: string;
  readonly bindingSource?: string;
  readonly expiresAt?: string;
  readonly expiresAtMs?: number;
  readonly scopes?: readonly string[];
};

export interface ZhiyuRuntimeAgentScopedBindingIssueRequest {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly conversationAnchorId: string;
  readonly scopes?: readonly string[];
  readonly issueRequestId?: string;
  readonly forceRenewal?: boolean;
}

export interface ZhiyuRuntimeAgentHostEquivalenceInput {
  readonly evidenceRef?: string;
  readonly authority?: string;
  readonly failureSemantics?: string;
}

export interface ZhiyuRuntimeAgentBindingHost {
  readonly scopedBinding?: ZhiyuScopedRuntimeBindingAttachment | null;
  readonly hostEquivalence?: ZhiyuRuntimeAgentHostEquivalenceInput | null;
  readonly localAppCarrier?: ZhiyuRuntimeAgentHostEquivalenceInput | null;
  readonly getScopedBinding?: () => ZhiyuScopedRuntimeBindingAttachment | null;
  readonly setScopedBinding?: (scopedBinding: ZhiyuNormalizedScopedRuntimeBindingAttachment) => unknown;
}

export type ZhiyuRuntimeAgentBindingDecision =
  | {
    readonly kind: 'runtime-issued-scoped-binding';
    readonly scopedBinding: ZhiyuNormalizedScopedRuntimeBindingAttachment;
  }
  | {
    readonly kind: 'runtime-sdk-authority-admitted-first-party-electron-host-equivalence';
    readonly evidenceRef: string;
  }
  | {
    readonly kind: 'local-app-carrier';
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

const ZHIYU_RUNTIME_AGENT_SCOPED_BINDING_COMMAND = 'zhiyu.runtimeAgent.issueScopedBinding';
const scopedBindingRefreshSkewMs = 60_000;

let scopedBindingCache: {
  readonly cacheKey: string;
  readonly scopedBinding: ZhiyuNormalizedScopedRuntimeBindingAttachment;
  readonly expiresAtMs: number;
} | null = null;
const scopedBindingInflight = new Map<string, Promise<ZhiyuRuntimeAgentBindingDecision>>();

type NormalizedScopedBindingIssueRequest = {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly conversationAnchorId: string;
  readonly scopes: readonly string[];
  readonly issueRequestId: string;
  readonly forceRenewal: boolean;
};

export function resolveZhiyuRuntimeAgentBindingDecision(input: {
  readonly scopedBinding?: ZhiyuScopedRuntimeBindingAttachment | null;
  readonly hostEquivalence?: ZhiyuRuntimeAgentHostEquivalenceInput | null;
  readonly localAppCarrier?: ZhiyuRuntimeAgentHostEquivalenceInput | null;
} = {}, requiredScopes: readonly string[] = []): ZhiyuRuntimeAgentBindingDecision {
  const scopedBinding = normalizeScopedBinding(input.scopedBinding);
  if (scopedBinding && scopedBindingCoversScopes(scopedBinding, requiredScopes)) {
    return {
      kind: 'runtime-issued-scoped-binding',
      scopedBinding,
    };
  }

  const localAppCarrier = normalizeHostEquivalence(input.localAppCarrier);
  if (localAppCarrier) {
    return {
      kind: 'local-app-carrier',
      evidenceRef: localAppCarrier.evidenceRef,
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

export function resolveZhiyuRuntimeAgentBindingDecisionFromHost(
  requiredScopes: readonly string[] = [],
): ZhiyuRuntimeAgentBindingDecision {
  const host = globalThis as typeof globalThis & {
    readonly window?: unknown;
    readonly __nimiZhiyuRuntimeAgentBinding?: ZhiyuRuntimeAgentBindingHost;
  };
  const windowBinding = isRecord(host.window)
    ? (host.window as { readonly __nimiZhiyuRuntimeAgentBinding?: ZhiyuRuntimeAgentBindingHost }).__nimiZhiyuRuntimeAgentBinding
    : undefined;
  return resolveZhiyuRuntimeAgentBindingDecision(
    readBindingHost(host.__nimiZhiyuRuntimeAgentBinding)
      ?? readBindingHost(windowBinding)
      ?? {},
    requiredScopes,
  );
}

export function scopedBindingForRuntimeAgentRequest(
  decision: ZhiyuRuntimeAgentBindingDecision,
): ZhiyuNormalizedScopedRuntimeBindingAttachment | undefined {
  return decision.kind === 'runtime-issued-scoped-binding' ? decision.scopedBinding : undefined;
}

export async function resolveZhiyuRuntimeAgentScopedBindingDecisionFromHost(
  input: ZhiyuRuntimeAgentScopedBindingIssueRequest,
): Promise<ZhiyuRuntimeAgentBindingDecision> {
  const request = normalizeScopedBindingIssueRequest(input);
  const cacheKey = scopedBindingCacheKey(request);
  if (
    scopedBindingCache
    && scopedBindingCache.cacheKey === cacheKey
    && !request.forceRenewal
    && !scopedBindingNeedsRenewal(scopedBindingCache.expiresAtMs)
  ) {
    installHostScopedBinding(scopedBindingCache.scopedBinding);
    return resolveZhiyuRuntimeAgentBindingDecision({ scopedBinding: scopedBindingCache.scopedBinding });
  }
  if (!request.forceRenewal) {
    const existing = scopedBindingInflight.get(cacheKey);
    if (existing) {
      return existing;
    }
  }
  const issuance = issueZhiyuRuntimeAgentScopedBindingFromHost(request, cacheKey).finally(() => {
    if (scopedBindingInflight.get(cacheKey) === issuance) {
      scopedBindingInflight.delete(cacheKey);
    }
  });
  if (!request.forceRenewal) {
    scopedBindingInflight.set(cacheKey, issuance);
  }
  return issuance;
}

async function issueZhiyuRuntimeAgentScopedBindingFromHost(
  request: NormalizedScopedBindingIssueRequest,
  cacheKey: string,
): Promise<ZhiyuRuntimeAgentBindingDecision> {
  const invoke = electronRuntimeInvoke();
  if (!invoke) {
    throw Object.assign(new Error('Electron Runtime bridge is not available for scoped Runtime Agent binding issuance.'), {
      reasonCode: 'electron-runtime-bridge-unavailable',
      actionHint: 'restart_zhiyu_electron_shell',
      source: 'renderer',
    });
  }
  const response = await invoke(ZHIYU_RUNTIME_AGENT_SCOPED_BINDING_COMMAND, request);
  const scopedBinding = normalizeScopedBinding((response as {
    readonly scopedBinding?: ZhiyuScopedRuntimeBindingAttachment | null;
  } | null | undefined)?.scopedBinding);
  if (!scopedBinding || scopedBinding.bindingSource !== 'runtime-account-service') {
    throw Object.assign(new Error('Runtime scoped binding issuer did not return Runtime account service evidence.'), {
      reasonCode: 'zhiyu-delegation-scoped-binding-required',
      actionHint: 'attach_runtime_scoped_delegation_binding',
      source: 'renderer',
    });
  }
  assertScopedBindingCoversScopes({
    kind: 'runtime-issued-scoped-binding',
    scopedBinding,
  }, request.scopes);
  const expiresAtMs = scopedBindingExpiresAtMs(scopedBinding);
  scopedBindingCache = {
    cacheKey,
    scopedBinding,
    expiresAtMs,
  };
  installHostScopedBinding(scopedBinding);
  return {
    kind: 'runtime-issued-scoped-binding',
    scopedBinding,
  };
}

export async function withZhiyuRuntimeAgentBindingScopes<T>(
  decision: ZhiyuRuntimeAgentBindingDecision,
  scopes: readonly string[],
  operation: (options: ZhiyuRuntimeTypedCallOptions) => Promise<T>,
): Promise<T> {
  assertZhiyuRuntimeAgentBindingDecision(decision);
  assertScopedBindingCoversScopes(decision, scopes);
  return operation(callOptionsForBindingDecision(decision));
}

export function createZhiyuRuntimeAgentBindingScopeRunner(
  resolveDecision: (scopes: readonly string[]) => ZhiyuRuntimeAgentBindingDecision | Promise<ZhiyuRuntimeAgentBindingDecision>,
): ZhiyuRuntimeAgentScopeRunner {
  return async (scopes, operation) => {
    const decision = await resolveDecision(scopes);
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
      metadata: metadataForScopedBinding(decision.scopedBinding),
    };
  }
  if (decision.kind === 'local-app-carrier') {
    return {};
  }
  return {
    metadata: {
      'x-nimi-runtime-host-equivalence': decision.evidenceRef,
    },
  };
}

function metadataForScopedBinding(
  scopedBinding: ZhiyuNormalizedScopedRuntimeBindingAttachment,
): Readonly<Record<string, string>> {
  return {
    'x-nimi-runtime-scoped-binding-id': scopedBinding.bindingId,
    'x-nimi-runtime-scoped-binding-handle': scopedBinding.bindingHandle,
    'x-nimi-runtime-scoped-binding-runtime-app-id': scopedBinding.runtimeAppId,
    'x-nimi-runtime-scoped-binding-app-instance-id': scopedBinding.appInstanceId,
    'x-nimi-runtime-scoped-binding-window-id': scopedBinding.windowId,
    'x-nimi-runtime-scoped-binding-avatar-instance-id': scopedBinding.avatarInstanceId,
    'x-nimi-runtime-scoped-binding-agent-id': scopedBinding.agentId,
    'x-nimi-runtime-scoped-binding-conversation-anchor-id': scopedBinding.conversationAnchorId,
    'x-nimi-runtime-scoped-binding-world-id': scopedBinding.worldId,
  };
}

function scopedBindingCoversScopes(
  scopedBinding: ZhiyuNormalizedScopedRuntimeBindingAttachment,
  requiredScopes: readonly string[],
): boolean {
  if (requiredScopes.length === 0) {
    return true;
  }
  const grantedScopes = new Set(scopedBinding.scopes ?? []);
  return requiredScopes.every((scope) => grantedScopes.has(scope));
}

function assertScopedBindingCoversScopes(
  decision: Exclude<ZhiyuRuntimeAgentBindingDecision, { readonly kind: 'missing' }>,
  requiredScopes: readonly string[],
): void {
  if (decision.kind !== 'runtime-issued-scoped-binding' || scopedBindingCoversScopes(decision.scopedBinding, requiredScopes)) {
    return;
  }
  const missingScopes = requiredScopes.filter((scope) => !(decision.scopedBinding.scopes ?? []).includes(scope));
  throw Object.assign(new Error(`Runtime scoped binding is missing required scopes: ${missingScopes.join(', ')}`), {
    reasonCode: 'zhiyu-runtime-agent-scoped-binding-scope-missing',
    actionHint: 'issue_runtime_scoped_binding_for_required_scopes',
    source: 'runtime',
  });
}

function normalizeScopedBinding(
  input: ZhiyuScopedRuntimeBindingAttachment | null | undefined,
): ZhiyuNormalizedScopedRuntimeBindingAttachment | null {
  const bindingId = normalizeText(input?.bindingId);
  if (!bindingId) {
    return null;
  }
  const record = input as ZhiyuScopedRuntimeBindingAttachment & {
    readonly bindingSource?: unknown;
    readonly expiresAt?: unknown;
    readonly expiresAtMs?: unknown;
    readonly scopes?: readonly unknown[];
  };
  const out: ZhiyuNormalizedScopedRuntimeBindingAttachment = {
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
  const bindingSource = normalizeText(record.bindingSource);
  const expiresAt = normalizeText(record.expiresAt);
  const expiresAtMs = normalizedPositiveNumber(record.expiresAtMs);
  const scopes = normalizeStringList(record.scopes ?? []);
  return {
    ...out,
    ...(bindingSource ? { bindingSource } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(expiresAtMs ? { expiresAtMs } : {}),
    ...(scopes ? { scopes } : {}),
  };
}

function normalizeScopedBindingIssueRequest(
  input: ZhiyuRuntimeAgentScopedBindingIssueRequest,
): NormalizedScopedBindingIssueRequest {
  const request = {
    ownerUserId: normalizeText(input.ownerUserId),
    runtimeSourceRef: normalizeText(input.runtimeSourceRef),
    localAgentRef: normalizeText(input.localAgentRef),
    conversationAnchorId: normalizeText(input.conversationAnchorId),
    scopes: normalizeStringList(input.scopes ?? [
      'runtime.agent.delegation.read',
      'runtime.agent.delegation.write',
    ]) ?? [],
    issueRequestId: normalizeText(input.issueRequestId) || createScopedBindingIssueRequestId(),
    forceRenewal: input.forceRenewal === true,
  };
  if (!request.ownerUserId || !request.runtimeSourceRef || !request.localAgentRef || !request.conversationAnchorId || request.scopes.length === 0) {
    throw Object.assign(new Error('Zhiyu Runtime Agent scoped binding issue request is incomplete.'), {
      reasonCode: 'zhiyu-delegation-scoped-binding-input-invalid',
      actionHint: 'provide_runtime_agent_delegation_identity',
      source: 'renderer',
    });
  }
  return request;
}

function scopedBindingCacheKey(input: NormalizedScopedBindingIssueRequest): string {
  return [
    input.ownerUserId,
    input.runtimeSourceRef,
    input.localAgentRef,
    input.conversationAnchorId,
    input.scopes.join('|'),
  ].join('\u001f');
}

function createScopedBindingIssueRequestId(): string {
  const cryptoApi = (globalThis as typeof globalThis & {
    readonly crypto?: { readonly randomUUID?: () => string };
  }).crypto;
  const randomUUID = cryptoApi?.randomUUID;
  if (typeof randomUUID === 'function') {
    return `issue-${randomUUID.call(cryptoApi)}`;
  }
  return `issue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function installHostScopedBinding(scopedBinding: ZhiyuNormalizedScopedRuntimeBindingAttachment): void {
  const root = globalThis as typeof globalThis & {
    __nimiZhiyuRuntimeAgentBinding?: ZhiyuRuntimeAgentBindingHost;
    window?: {
      __nimiZhiyuRuntimeAgentBinding?: ZhiyuRuntimeAgentBindingHost;
    };
  };
  for (const bindingHost of [root.window?.__nimiZhiyuRuntimeAgentBinding, root.__nimiZhiyuRuntimeAgentBinding]) {
    if (installIntoBindingHost(bindingHost, scopedBinding)) {
      return;
    }
  }
  const hostBinding: ZhiyuRuntimeAgentBindingHost = { scopedBinding };
  if (root.window && writeRecordProperty(root.window, '__nimiZhiyuRuntimeAgentBinding', hostBinding)) {
    return;
  }
  writeRecordProperty(root, '__nimiZhiyuRuntimeAgentBinding', hostBinding);
}

function electronRuntimeInvoke(): ((command: string, payload?: unknown) => Promise<unknown>) | null {
  const root = globalThis as typeof globalThis & {
    __NIMI_ELECTRON_TEST__?: { readonly invoke?: (command: string, payload?: unknown) => Promise<unknown> };
    __NIMI_ELECTRON_RUNTIME__?: { readonly invoke?: (command: string, payload?: unknown) => Promise<unknown> };
    window?: {
      __NIMI_ELECTRON_TEST__?: { readonly invoke?: (command: string, payload?: unknown) => Promise<unknown> };
      __NIMI_ELECTRON_RUNTIME__?: { readonly invoke?: (command: string, payload?: unknown) => Promise<unknown> };
    };
  };
  return root.window?.__NIMI_ELECTRON_TEST__?.invoke
    ?? root.__NIMI_ELECTRON_TEST__?.invoke
    ?? root.window?.__NIMI_ELECTRON_RUNTIME__?.invoke
    ?? root.__NIMI_ELECTRON_RUNTIME__?.invoke
    ?? null;
}

function scopedBindingNeedsRenewal(expiresAtMs: number): boolean {
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= 0 || expiresAtMs - Date.now() <= scopedBindingRefreshSkewMs;
}

function scopedBindingExpiresAtMs(scopedBinding: ZhiyuNormalizedScopedRuntimeBindingAttachment): number {
  const explicit = normalizedPositiveNumber(scopedBinding.expiresAtMs);
  if (explicit) {
    return explicit;
  }
  const parsed = Date.parse(scopedBinding.expiresAt ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function readBindingHost(input: ZhiyuRuntimeAgentBindingHost | null | undefined): {
  readonly scopedBinding?: ZhiyuScopedRuntimeBindingAttachment | null;
  readonly hostEquivalence?: ZhiyuRuntimeAgentHostEquivalenceInput | null;
  readonly localAppCarrier?: ZhiyuRuntimeAgentHostEquivalenceInput | null;
} | null {
  if (!isRecord(input)) {
    return null;
  }
  const host = input as ZhiyuRuntimeAgentBindingHost;
  const getScopedBinding = host.getScopedBinding;
  const scopedBinding = typeof getScopedBinding === 'function'
    ? callBindingGetter(host, getScopedBinding)
    : host.scopedBinding;
  return {
    scopedBinding,
    hostEquivalence: host.hostEquivalence,
    localAppCarrier: host.localAppCarrier,
  };
}

function callBindingGetter(
  host: ZhiyuRuntimeAgentBindingHost,
  getScopedBinding: () => ZhiyuScopedRuntimeBindingAttachment | null,
): ZhiyuScopedRuntimeBindingAttachment | null {
  try {
    return getScopedBinding.call(host);
  } catch {
    return null;
  }
}

function installIntoBindingHost(
  host: ZhiyuRuntimeAgentBindingHost | null | undefined,
  scopedBinding: ZhiyuNormalizedScopedRuntimeBindingAttachment,
): boolean {
  if (!isRecord(host)) {
    return false;
  }
  if (typeof host.setScopedBinding === 'function') {
    try {
      host.setScopedBinding(scopedBinding);
      return true;
    } catch {
      return false;
    }
  }
  return writeRecordProperty(host, 'scopedBinding', scopedBinding);
}

function writeRecordProperty(target: object, key: string, value: unknown): boolean {
  try {
    (target as Record<string, unknown>)[key] = value;
    if ((target as Record<string, unknown>)[key] === value) {
      return true;
    }
  } catch {
    // contextBridge exposes immutable window properties; defineProperty is a fallback for plain test hosts.
  }
  try {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    });
    return (target as Record<string, unknown>)[key] === value;
  } catch {
    return false;
  }
}

function normalizeStringList(values: readonly unknown[]): readonly string[] | undefined {
  const normalized = [...new Set(values.map(normalizeText).filter(Boolean))].sort();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizedPositiveNumber(value: unknown): number {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
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

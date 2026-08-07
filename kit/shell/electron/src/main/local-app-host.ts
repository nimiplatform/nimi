import { loadNimiElectronProtectedLocalPackage } from './protected-local-binding-loader.js';

const WINDOWS_X64_BINDING_PACKAGE = '@nimiplatform/kit-protected-local-win32-x64';
const MACOS_ARM64_BINDING_PACKAGE = '@nimiplatform/kit-protected-local-darwin-arm64';

const LOCAL_APP_BINDING_METHODS = [
  'localAppSessionStatus',
  'localAppSessionRenew',
  'localAppAIConfigGet',
  'localAppAIConfigOverwrite',
  'localAppTextGenerateCandidate',
  'localAppRealmWorldCoreList',
  'localAppRealmWorldCoreCreate',
  'localAppAgentReferenceList',
  'localAppStorageReadJson',
  'localAppStorageWriteJson',
  'localAppStorageRemoveJson',
  'localAppConversationOpen',
  'localAppConversationSendTurn',
  'localAppConversationInterruptTurn',
  'localAppConversationSubscribe',
  'localAppConversationStreamNext',
  'localAppConversationStreamClose',
  'localAppConversationSnapshot',
] as const;

const ADMITTED_REASON_CODES: ReadonlySet<string> = new Set([
  'protected-carrier-required',
  'runtime-service-unavailable',
  'runtime-service-untrusted',
  'runtime-service-error-unclassified',
  'runtime-service-repair-required',
  'runtime-unauthenticated',
  'process-replaced',
  'account-changed',
  'runtime-restarted',
  'revoked',
  'project-changed',
  'presence-expired',
  'runtime-access-denied',
  'ai-model-not-found',
  'ai-model-not-ready',
  'ai-provider-unavailable',
  'ai-route-unsupported',
  'ai-route-fallback-denied',
  'ai-connector-grant-selection-required',
  'ai-input-invalid',
  'ai-output-invalid',
  'ai-content-filter-blocked',
  'ai-local-model-unavailable',
  'ai-local-model-profile-missing',
  'ai-local-service-unavailable',
  'ai-local-driver-unavailable',
  'ai-local-selection-not-found',
  'ai-local-capability-mismatch',
  'ai-local-configuration-not-configured',
  'ai-provider-auth-failed',
  'ai-provider-internal',
  'ai-provider-rate-limited',
  'ai-provider-timeout',
  'local-app-operation-unavailable',
  'local-app-snapshot-unavailable',
  'local-app-access-denied',
  'local-app-operation-unsupported',
  'local-app-owner-unavailable',
  'ai-config-invalid',
  'ai-config-not-found',
  'ai-config-persistence-unavailable',
  'invalid-payload',
  'not-found',
  'resource-exhausted',
  'invalid-path',
] as const);

const ADMITTED_REASON_METADATA_KEYS: ReadonlySet<string> = new Set([
  'diagnostic_stage',
  'local_development_reason_code',
  'capability',
  'grpc_status_code',
]);

const FORBIDDEN_PORTABLE_APP_AI_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'account', 'accountid', 'accesstoken', 'authorization', 'binding', 'bindingid',
  'connectorgrant', 'connectorgrantid', 'credential', 'custody', 'custodymaterial',
  'grantid', 'providercredential', 'refreshtoken', 'token',
]);

const FORBIDDEN_PROJECTION_KEYS: ReadonlySet<string> = new Set([
  'endpoint',
  'authorization',
  'token',
  'localAppPrincipalId',
  'localAppRecordId',
  'trustClass',
  'provenanceRevision',
  'launchLease',
  'bootstrap',
  'processId',
  'sessionId',
  'sessionProof',
  'accountId',
  'grantId',
  'runtimeBootEpoch',
  'registeredAppSubject',
  'registrationHandle',
  'sourceGeneration',
  'declarationGeneration',
  'accountGeneration',
  'snapshotId',
  'credential',
  'peerProof',
  'classification',
  'domainId',
  'operationId',
] as const);

export type NimiElectronLocalAppJson =
  | null
  | boolean
  | number
  | string
  | readonly NimiElectronLocalAppJson[]
  | { readonly [key: string]: NimiElectronLocalAppJson };

export type NimiElectronLocalAppRecord = {
  readonly [key: string]: NimiElectronLocalAppJson;
};

type NativeLocalAppOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | {
      readonly status: 'error';
      readonly reasonCode: string;
      readonly retryable: boolean;
      readonly reasonMetadata?: unknown;
    };

export type NimiElectronProtectedLocalBinding = {
  readonly localAppSessionStatus: () => Promise<NativeLocalAppOutcome>;
  readonly localAppSessionRenew: () => Promise<NativeLocalAppOutcome>;
  readonly localAppAIConfigGet: () => Promise<NativeLocalAppOutcome>;
  readonly localAppAIConfigOverwrite: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppTextGenerateCandidate: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldCoreList: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldCoreCreate: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentReferenceList: () => Promise<NativeLocalAppOutcome>;
  readonly localAppStorageReadJson: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppStorageWriteJson: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppStorageRemoveJson: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationOpen: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationSendTurn: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationInterruptTurn: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationStreamNext: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationStreamClose: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationSnapshot: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
};

export type NimiElectronLocalAppHost = {
  readonly sessionStatus: () => Promise<NimiElectronLocalAppRecord>;
  readonly renewTechnicalSession: () => Promise<NimiElectronLocalAppRecord>;
  readonly aiConfigGet: () => Promise<NimiElectronLocalAppRecord>;
  readonly aiConfigOverwrite: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly textGenerateCandidate: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmWorldCoreList: (input: NimiElectronLocalAppRecord) => Promise<readonly NimiElectronLocalAppRecord[]>;
  readonly realmWorldCoreCreate: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentReferenceList: () => Promise<readonly NimiElectronLocalAppRecord[]>;
  readonly storageReadJson: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly storageWriteJson: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly storageRemoveJson: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationOpen: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationSendTurn: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationInterruptTurn: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationStreamNext: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationStreamClose: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationSnapshot: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
};

export type NimiElectronLocalAppMaintenanceFailure = {
  readonly reasonCode: string;
  readonly retryable: boolean;
};

const LOCAL_APP_SESSION_ROTATION_INTERVAL_MS = 5 * 60 * 1_000;
const LOCAL_APP_SESSION_REBIND_TIMEOUT_MS = 2_000;
const LOCAL_APP_SESSION_INVALID_REASONS: ReadonlySet<string> = new Set([
  'runtime-unauthenticated',
  'process-replaced',
  'account-changed',
  'runtime-restarted',
  'revoked',
  'project-changed',
  'local-app-snapshot-unavailable',
]);

export class NimiElectronLocalAppHostError extends Error {
  readonly reasonCode: string;
  readonly retryable: boolean;
  readonly reasonMetadata: Readonly<Record<string, string>>;

  constructor(
    reasonCode: string,
    retryable: boolean,
    reasonMetadata: Readonly<Record<string, string>> = {},
  ) {
    super(reasonCode);
    this.name = 'NimiElectronLocalAppHostError';
    this.reasonCode = reasonCode;
    this.retryable = retryable;
    this.reasonMetadata = Object.freeze({ ...reasonMetadata });
  }
}

function withBoundedSessionRebind(
  binding: NimiElectronProtectedLocalBinding,
): NimiElectronProtectedLocalBinding {
  let rebindInFlight: Promise<NativeLocalAppOutcome> | undefined;
  const renew = (): Promise<NativeLocalAppOutcome> => {
    rebindInFlight ??= boundedSessionRenew(binding).finally(() => {
      rebindInFlight = undefined;
    });
    return rebindInFlight;
  };
  return new Proxy(binding, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (
        typeof property !== 'string'
        || typeof value !== 'function'
        || property === 'localAppSessionStatus'
        || property === 'localAppSessionRenew'
        || !LOCAL_APP_BINDING_METHODS.includes(property as typeof LOCAL_APP_BINDING_METHODS[number])
      ) {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (...args: unknown[]): Promise<NativeLocalAppOutcome> => {
        const first = await Reflect.apply(value, target, args) as NativeLocalAppOutcome;
        if (!isSessionInvalidOutcome(first)) {
          return first;
        }
        const rebound = await renew();
        if (!isReadySessionOutcome(rebound)) {
          return rebound.status === 'error' ? rebound : untrustedNativeOutcome();
        }
        return Reflect.apply(value, target, args) as Promise<NativeLocalAppOutcome>;
      };
    },
  });
}

async function boundedSessionRenew(
  binding: NimiElectronProtectedLocalBinding,
): Promise<NativeLocalAppOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      binding.localAppSessionRenew().catch(() => untrustedNativeOutcome()),
      new Promise<NativeLocalAppOutcome>((resolve) => {
        timer = setTimeout(() => resolve({
          status: 'error', reasonCode: 'runtime-service-unavailable', retryable: true,
        }), LOCAL_APP_SESSION_REBIND_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isSessionInvalidOutcome(outcome: NativeLocalAppOutcome): boolean {
  return outcome?.status === 'error' && LOCAL_APP_SESSION_INVALID_REASONS.has(outcome.reasonCode);
}

function isReadySessionOutcome(outcome: NativeLocalAppOutcome): boolean {
  if (outcome?.status !== 'ok' || !isPlainRecord(outcome.value)) return false;
  if (!hasExactKeys(outcome.value, ['state', 'reasonCode', 'retryable', 'currentUser'])
    || outcome.value.state !== 'ready'
    || outcome.value.reasonCode !== 'action-executed'
    || outcome.value.retryable !== false
    || !isPlainRecord(outcome.value.currentUser)
    || !hasExactKeys(outcome.value.currentUser, ['state', 'value', 'reasonCode', 'retryable'])) return false;
  const currentUser = outcome.value.currentUser;
  if (currentUser.state === 'unavailable') {
    return currentUser.value === null
      && currentUser.reasonCode === 'current-user-display-unavailable'
      && currentUser.retryable === true;
  }
  return currentUser.state === 'ready'
    && isPlainRecord(currentUser.value)
    && hasExactKeys(currentUser.value, ['handle', 'displayName', 'avatarUrl'])
    && currentUser.reasonCode === 'action-executed'
    && currentUser.retryable === false;
}

function untrustedNativeOutcome(): NativeLocalAppOutcome {
  return { status: 'error', reasonCode: 'runtime-service-untrusted', retryable: false };
}

class ElectronLocalAppHost implements NimiElectronLocalAppHost {
  private readonly binding: NimiElectronProtectedLocalBinding;

  constructor(binding: NimiElectronProtectedLocalBinding) {
    this.binding = withBoundedSessionRebind(binding);
  }

  sessionStatus(): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppSessionStatus());
  }

  renewTechnicalSession(): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppSessionRenew());
  }

  aiConfigGet(): Promise<NimiElectronLocalAppRecord> {
    return invokePortableAppAIConfig(() => this.binding.localAppAIConfigGet());
  }

  aiConfigOverwrite(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokePortableAppAIConfig(() => this.binding.localAppAIConfigOverwrite(input));
  }

  textGenerateCandidate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeTextCandidate(() => this.binding.localAppTextGenerateCandidate(input));
  }

  realmWorldCoreList(input: NimiElectronLocalAppRecord): Promise<readonly NimiElectronLocalAppRecord[]> {
    return invokeWorldCoreList(() => this.binding.localAppRealmWorldCoreList(input));
  }

  realmWorldCoreCreate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeWorldCore(() => this.binding.localAppRealmWorldCoreCreate({ body: input }));
  }

  agentReferenceList(): Promise<readonly NimiElectronLocalAppRecord[]> {
    return invokeAgentReferenceList(() => this.binding.localAppAgentReferenceList());
  }

  storageReadJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeStorageDocument(() => this.binding.localAppStorageReadJson(input));
  }

  storageWriteJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeStorageDocument(() => this.binding.localAppStorageWriteJson(input));
  }

  storageRemoveJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeStorageRemove(() => this.binding.localAppStorageRemoveJson(input));
  }

  conversationOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeConversationOpen(() => this.binding.localAppConversationOpen(input));
  }

  conversationSendTurn(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppConversationSendTurn(input), ['turnId']);
  }

  conversationInterruptTurn(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppConversationInterruptTurn(input), ['turnId']);
  }

  conversationSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppConversationSubscribe(input), ['streamId']);
  }

  conversationStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeConversationStreamNext(() => this.binding.localAppConversationStreamNext(input));
  }

  conversationStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeConversationStreamClose(() => this.binding.localAppConversationStreamClose(input));
  }

  conversationSnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeConversationSnapshot(() => this.binding.localAppConversationSnapshot(input));
  }

}

class LazyElectronLocalAppHost implements NimiElectronLocalAppHost {
  private host: NimiElectronLocalAppHost | undefined;

  private resolve(): NimiElectronLocalAppHost {
    this.host ??= new ElectronLocalAppHost(loadPlatformBinding());
    return this.host;
  }

  sessionStatus(): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().sessionStatus();
  }

  renewTechnicalSession(): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().renewTechnicalSession();
  }

  aiConfigGet(): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().aiConfigGet();
  }

  aiConfigOverwrite(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().aiConfigOverwrite(input);
  }

  textGenerateCandidate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().textGenerateCandidate(input);
  }

  realmWorldCoreList(input: NimiElectronLocalAppRecord): Promise<readonly NimiElectronLocalAppRecord[]> {
    return this.resolve().realmWorldCoreList(input);
  }

  realmWorldCoreCreate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmWorldCoreCreate(input);
  }

  agentReferenceList(): Promise<readonly NimiElectronLocalAppRecord[]> {
    return this.resolve().agentReferenceList();
  }

  storageReadJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().storageReadJson(input);
  }

  storageWriteJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().storageWriteJson(input);
  }

  storageRemoveJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().storageRemoveJson(input);
  }

  conversationOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationOpen(input);
  }

  conversationSendTurn(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationSendTurn(input);
  }

  conversationInterruptTurn(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationInterruptTurn(input);
  }

  conversationSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationSubscribe(input);
  }

  conversationStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationStreamNext(input);
  }

  conversationStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationStreamClose(input);
  }

  conversationSnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationSnapshot(input);
  }

}

export function createNimiElectronLocalAppHost(): NimiElectronLocalAppHost {
  return new LazyElectronLocalAppHost();
}

/**
 * Starts the request-empty native session bootstrap from Electron main.
 * The renderer still receives only the sanitized status projection, while a
 * cold renderer build cannot consume the Runtime's exact process-bind window.
 */
export async function primeNimiElectronLocalAppHost(
  host: NimiElectronLocalAppHost,
): Promise<void> {
  await host.sessionStatus();
}

/** @internal Keeps Runtime-owned technical session rotation outside renderer state. */
export function startNimiElectronLocalAppHostMaintenance(
  host: NimiElectronLocalAppHost,
  intervalMs = LOCAL_APP_SESSION_ROTATION_INTERVAL_MS,
  onFailure: (failure: NimiElectronLocalAppMaintenanceFailure) => void = () => undefined,
): { readonly ready: Promise<void>; readonly close: () => void } {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error('Electron local-app session rotation interval is invalid');
  }
  let closed = false;
  let failed = false;
  let rotating = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const close = () => {
    closed = true;
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const fail = (error: unknown) => {
    if (failed) return;
    failed = true;
    close();
    const failure = error instanceof NimiElectronLocalAppHostError
      ? { reasonCode: error.reasonCode, retryable: error.retryable }
      : { reasonCode: 'runtime-service-untrusted', retryable: false };
    try {
      onFailure(Object.freeze(failure));
    } catch {
      // The protected bridge is already closed by the owner callback. A shell
      // lifecycle callback cannot turn failed renewal back into a live session.
    }
  };
  const rotate = async () => {
    if (closed || rotating) return;
    rotating = true;
    try {
      await host.renewTechnicalSession();
    } catch (error) {
      fail(error);
    } finally {
      rotating = false;
    }
  };
  const ready = primeNimiElectronLocalAppHost(host).then(() => {
    if (closed) return;
    timer = setInterval(() => void rotate(), intervalMs);
    timer.unref?.();
  }, (error: unknown) => {
    fail(error);
    throw error;
  });
  return { ready, close };
}

/** @internal Focused contract-test seam; not re-exported from the public main entrypoint. */
export function createNimiElectronLocalAppHostForBinding(
  binding: NimiElectronProtectedLocalBinding,
): NimiElectronLocalAppHost {
  return new ElectronLocalAppHost(validateBinding(binding));
}

/** @internal Platform-package resolver used by release and fail-closed tests. */
export function resolveNimiElectronProtectedLocalBindingPackage(platform: string, architecture: string): string {
  if (platform === 'win32' && architecture === 'x64') return WINDOWS_X64_BINDING_PACKAGE;
  if (platform === 'darwin' && architecture === 'arm64') return MACOS_ARM64_BINDING_PACKAGE;
  throw new NimiElectronLocalAppHostError('protected-carrier-required', false);
}

function loadPlatformBinding(): NimiElectronProtectedLocalBinding {
  const packageName = resolveNimiElectronProtectedLocalBindingPackage(process.platform, process.arch);
  try {
    return validateBinding(loadNimiElectronProtectedLocalPackage(packageName));
  } catch (error) {
    if (error instanceof NimiElectronLocalAppHostError) throw error;
    throw new NimiElectronLocalAppHostError('protected-carrier-required', false);
  }
}

function validateBinding(value: unknown): NimiElectronProtectedLocalBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw untrustedRuntimeError();
  const candidate = value as Record<string, unknown>;
  if (LOCAL_APP_BINDING_METHODS.some((method) => typeof candidate[method] !== 'function')) {
    throw untrustedRuntimeError();
  }
  return candidate as NimiElectronProtectedLocalBinding;
}

async function invoke(call: () => Promise<NativeLocalAppOutcome>): Promise<unknown> {
  let outcome: NativeLocalAppOutcome;
  try {
    outcome = await call();
  } catch {
    throw untrustedRuntimeError();
  }
  if (outcome?.status === 'error') {
    const reasonCode = typeof outcome.reasonCode === 'string' ? outcome.reasonCode : '';
    if (!ADMITTED_REASON_CODES.has(reasonCode) || typeof outcome.retryable !== 'boolean') {
      throw untrustedRuntimeError();
    }
    throw new NimiElectronLocalAppHostError(
      reasonCode,
      outcome.retryable,
      validateReasonMetadata(outcome.reasonMetadata),
    );
  }
  if (outcome?.status !== 'ok' || !Object.hasOwn(outcome, 'value')) throw untrustedRuntimeError();
  return outcome.value;
}

async function invokeRecord(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  return validateProjection(await invoke(call));
}

async function invokePortableAppAIConfig(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invokeRecord(call);
  rejectPortableAppAIConfigProjection(value);
  return value;
}

function rejectPortableAppAIConfigProjection(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) rejectPortableAppAIConfigProjection(entry);
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
    if (FORBIDDEN_PORTABLE_APP_AI_CONFIG_KEYS.has(normalized)) {
      throw untrustedRuntimeError();
    }
    rejectPortableAppAIConfigProjection(entry);
  }
}

async function invokeTextCandidate(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ['text', 'finishReason', 'traceId'])
    || typeof value.text !== 'string'
    || !value.text.trim()
    || Buffer.byteLength(value.text, 'utf8') > 256 * 1024
    || (value.finishReason !== 'stop'
      && value.finishReason !== 'length'
      && value.finishReason !== 'content-filter')) {
    throw untrustedRuntimeError();
  }
  const traceId = exactText(value.traceId);
  return Object.freeze({ text: value.text, finishReason: value.finishReason, traceId });
}

async function invokeWorldCoreList(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<readonly NimiElectronLocalAppRecord[]> {
  const value = await invoke(call);
  if (!Array.isArray(value)) throw untrustedRuntimeError();
  return Object.freeze(value.map((entry) => validateWorldCore(entry)));
}

async function invokeAgentReferenceList(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<readonly NimiElectronLocalAppRecord[]> {
  const value = await invoke(call);
  if (!Array.isArray(value)) throw new NimiElectronLocalAppHostError('runtime-service-untrusted', false);
  return Object.freeze(value.map((entry) => {
    if (!isPlainRecord(entry) || !hasExactKeys(entry, ['agentHandle', 'displayName', 'avatarUrl'])) {
      throw new NimiElectronLocalAppHostError('runtime-service-untrusted', false);
    }
    validateProjectionValue(entry);
    if (typeof entry.agentHandle !== 'string'
      || !/^agent_ref_[A-Za-z0-9_-]{43}$/u.test(entry.agentHandle)
      || typeof entry.displayName !== 'string'
      || !entry.displayName
      || entry.displayName.trim() !== entry.displayName
      || Buffer.byteLength(entry.displayName, 'utf8') > 256
      || (entry.avatarUrl !== null && !safeAgentAvatarUrl(entry.avatarUrl))) {
      throw new NimiElectronLocalAppHostError('runtime-service-untrusted', false);
    }
    return Object.freeze({
      agentHandle: entry.agentHandle,
      displayName: entry.displayName,
      avatarUrl: entry.avatarUrl as string | null,
    }) as NimiElectronLocalAppRecord;
  }));
}

async function invokeWorldCore(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  return validateWorldCore(await invoke(call));
}

function validateWorldCore(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value)) throw untrustedRuntimeError();
  validateJsonValue(value);
  validateProjectionValue(value);
  return Object.freeze({ ...value }) as NimiElectronLocalAppRecord;
}

async function invokeStorageDocument(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['sizeBytes', 'value'])) {
    throw untrustedRuntimeError();
  }
  const sizeBytes = Number(value.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > 256 * 1024) {
    throw untrustedRuntimeError();
  }
  validateJsonValue(value.value);
  return Object.freeze({ value: value.value as NimiElectronLocalAppJson, sizeBytes });
}

async function invokeStorageRemove(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || JSON.stringify(Object.keys(value)) !== JSON.stringify(['removed']) || typeof value.removed !== 'boolean') {
    throw untrustedRuntimeError();
  }
  return Object.freeze({ removed: value.removed });
}

async function invokeConversationOpen(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['conversationAnchorId', 'activeTurnId'])) {
    throw untrustedRuntimeError();
  }
  const conversationAnchorId = exactText(value.conversationAnchorId);
  const activeTurnId = optionalExactText(value.activeTurnId);
  return Object.freeze({ conversationAnchorId, activeTurnId });
}

async function invokeExactTextRecord(
  call: () => Promise<NativeLocalAppOutcome>,
  keys: readonly string[],
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, keys)) throw untrustedRuntimeError();
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, exactText(value[key])]))) as NimiElectronLocalAppRecord;
}

async function invokeConversationStreamNext(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || typeof value.completed !== 'boolean') throw untrustedRuntimeError();
  if (value.completed) {
    if (!hasExactKeys(value, ['completed'])) throw untrustedRuntimeError();
    return Object.freeze({ completed: true });
  }
  if (!hasExactKeys(value, ['completed', 'event']) || !isPlainRecord(value.event)) throw untrustedRuntimeError();
  const event = validateConversationEvent(value.event);
  return Object.freeze({ completed: false, event });
}

async function invokeConversationStreamClose(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['closed']) || typeof value.closed !== 'boolean') {
    throw untrustedRuntimeError();
  }
  return Object.freeze({ closed: value.closed });
}

function validateConversationEvent(value: Record<string, unknown>): NimiElectronLocalAppRecord {
  if (typeof value.sequence !== 'string'
    || !/^[1-9][0-9]*$/u.test(value.sequence)
    || typeof value.type !== 'string') {
    throw untrustedRuntimeError();
  }
  exactText(value.conversationAnchorId);
  exactText(value.turnId);
  const common = ['type', 'conversationAnchorId', 'sequence', 'turnId'];
  switch (value.type) {
    case 'turn-accepted':
      if (!hasExactKeys(value, [...common, 'requestId'])) throw untrustedRuntimeError();
      exactText(value.requestId);
      break;
    case 'turn-started':
      if (!hasExactKeys(value, common)) throw untrustedRuntimeError();
      break;
    case 'text-delta':
      if (!hasExactKeys(value, [...common, 'text'])) throw untrustedRuntimeError();
      exactText(value.text);
      break;
    case 'message-committed':
      if (!hasExactKeys(value, [...common, 'messageId', 'text'])) throw untrustedRuntimeError();
      exactText(value.messageId);
      exactText(value.text);
      break;
    case 'turn-completed':
      if (!hasExactKeys(value, [...common, 'terminalReason'])
        || typeof value.terminalReason !== 'string'
        || !['', 'stop', 'length', 'tool_call', 'content_filter', 'error', 'unspecified'].includes(value.terminalReason)) {
        throw untrustedRuntimeError();
      }
      break;
    case 'turn-failed':
      if (!hasExactKeys(value, [...common, 'reasonCode', 'message'])
        || typeof value.reasonCode !== 'string'
        || !/^[A-Z0-9_-]{1,128}$/u.test(value.reasonCode)
        || (value.message !== null && typeof value.message !== 'string')) {
        throw untrustedRuntimeError();
      }
      if (typeof value.message === 'string') exactText(value.message);
      break;
    case 'turn-interrupted':
      if (!hasExactKeys(value, [...common, 'reason'])
        || typeof value.reason !== 'string'
        || !['user_cancel', 'room_closed', 'superseded_turn', 'budget_exhausted', 'timeout', 'gateway_revoked', 'policy_refusal'].includes(value.reason)) {
        throw untrustedRuntimeError();
      }
      break;
    default:
      throw untrustedRuntimeError();
  }
  return Object.freeze({ ...value }) as NimiElectronLocalAppRecord;
}

async function invokeConversationSnapshot(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ['conversationAnchorId', 'activeTurnId', 'messages', 'truncatedBefore'])
    || !Array.isArray(value.messages)
    || value.messages.length > 200
    || typeof value.truncatedBefore !== 'boolean') {
    throw untrustedRuntimeError();
  }
  const conversationAnchorId = exactText(value.conversationAnchorId);
  const activeTurnId = optionalExactText(value.activeTurnId);
  let textBytes = 0;
  const messages = value.messages.map((entry) => {
    if (!isPlainRecord(entry) || !hasExactKeys(entry, ['turnId', 'role', 'text'])
      || (entry.role !== 'user' && entry.role !== 'assistant')) {
      throw untrustedRuntimeError();
    }
    const turnId = exactText(entry.turnId);
    const text = exactText(entry.text);
    textBytes += new TextEncoder().encode(text).byteLength;
    if (textBytes > 1024 * 1024) throw untrustedRuntimeError();
    return Object.freeze({ turnId, role: entry.role, text }) as NimiElectronLocalAppRecord;
  });
  return Object.freeze({
    conversationAnchorId,
    activeTurnId,
    messages: Object.freeze(messages),
    truncatedBefore: value.truncatedBefore,
  });
}

function validateReasonMetadata(value: unknown): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  if (!isPlainRecord(value) || Object.keys(value).length > ADMITTED_REASON_METADATA_KEYS.size) {
    throw untrustedRuntimeError();
  }
  const metadata: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!ADMITTED_REASON_METADATA_KEYS.has(key)
      || typeof entry !== 'string'
      || entry.length === 0
      || entry.length > 2048
      || entry.trim() !== entry
      || /[\u0000-\u001f\u007f]/u.test(entry)) {
      throw untrustedRuntimeError();
    }
    metadata[key] = entry;
  }
  return Object.freeze(metadata);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function safeAgentAvatarUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.username === ''
      && parsed.password === ''
      && parsed.search === ''
      && parsed.hash === ''
      && (parsed.port === '' || parsed.port === '443')
      && parsed.hostname !== 'localhost'
      && !parsed.hostname.endsWith('.localhost')
      && !parsed.hostname.endsWith('.local')
      && !parsed.hostname.endsWith('.internal')
      && !/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(parsed.hostname)
      && !parsed.hostname.includes(':');
  } catch {
    return false;
  }
}

function exactText(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 512) throw untrustedRuntimeError();
  return value;
}

function optionalExactText(value: unknown): string | null {
  if (value === null) return null;
  return exactText(value);
}

function validateJsonValue(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  budget.nodes += 1;
  if (depth > 32 || budget.nodes > 100_000) throw untrustedRuntimeError();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const entry of value) validateJsonValue(entry, depth + 1, budget);
    return;
  }
  if (!isPlainRecord(value)) throw untrustedRuntimeError();
  for (const entry of Object.values(value)) validateJsonValue(entry, depth + 1, budget);
}

function validateProjection(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value)) throw untrustedRuntimeError();
  validateProjectionValue(value);
  return Object.freeze({ ...value }) as NimiElectronLocalAppRecord;
}

function validateProjectionValue(value: unknown): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const entry of value) validateProjectionValue(entry);
    return;
  }
  if (!isPlainRecord(value)) throw untrustedRuntimeError();
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PROJECTION_KEYS.has(key)) throw untrustedRuntimeError();
    validateProjectionValue(entry);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function untrustedRuntimeError(): NimiElectronLocalAppHostError {
  return new NimiElectronLocalAppHostError('runtime-service-untrusted', false);
}

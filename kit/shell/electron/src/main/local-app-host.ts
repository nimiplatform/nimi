import { createRequire } from 'node:module';

const WINDOWS_X64_BINDING_PACKAGE = '@nimiplatform/kit-protected-local-win32-x64';

const LOCAL_APP_BINDING_METHODS = [
  'localAppSessionStatus',
  'localAppPermissionPosture',
  'localAppPermissionRequest',
  'localAppArtifactsReadRuntimeBytes',
  'localAppAgentOpenConversation',
  'localAppAgentSendTurn',
  'localAppAgentSubscribeTurn',
  'localAppAgentGetConversationSnapshot',
] as const;

const ADMITTED_REASON_CODES: ReadonlySet<string> = new Set([
  'protected-carrier-required',
  'runtime-service-unavailable',
  'runtime-service-untrusted',
  'runtime-service-repair-required',
  'runtime-unauthenticated',
  'process-replaced',
  'account-changed',
  'runtime-restarted',
  'revoked',
  'project-changed',
  'no-grant',
  'grant-revoked',
  'grant-superseded',
  'presence-expired',
  'runtime-permission-denied',
  'invalid-payload',
  'not-found',
  'resource-exhausted',
] as const);

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

export type NimiElectronLocalAppArtifactBytes = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly mimeInferred: boolean;
};

type NativeLocalAppOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'error'; readonly reasonCode: string; readonly retryable: boolean };

export type NimiElectronProtectedLocalBinding = {
  readonly localAppSessionStatus: () => Promise<NativeLocalAppOutcome>;
  readonly localAppPermissionPosture: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppPermissionRequest: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppArtifactsReadRuntimeBytes: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentOpenConversation: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentSendTurn: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentSubscribeTurn: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentGetConversationSnapshot: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
};

export type NimiElectronLocalAppHost = {
  readonly sessionStatus: () => Promise<NimiElectronLocalAppRecord>;
  readonly permissionPosture: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly permissionRequest: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly artifactsReadRuntimeBytes: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppArtifactBytes>;
  readonly agentOpenConversation: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentSendTurn: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentSubscribeTurn: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentGetConversationSnapshot: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
};

export class NimiElectronLocalAppHostError extends Error {
  readonly reasonCode: string;
  readonly retryable: boolean;

  constructor(reasonCode: string, retryable: boolean) {
    super(reasonCode);
    this.name = 'NimiElectronLocalAppHostError';
    this.reasonCode = reasonCode;
    this.retryable = retryable;
  }
}

class ElectronLocalAppHost implements NimiElectronLocalAppHost {
  constructor(private readonly binding: NimiElectronProtectedLocalBinding) {}

  sessionStatus(): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppSessionStatus());
  }

  permissionPosture(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppPermissionPosture(input));
  }

  permissionRequest(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppPermissionRequest(input));
  }

  async artifactsReadRuntimeBytes(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppArtifactBytes> {
    const value = await invoke(() => this.binding.localAppArtifactsReadRuntimeBytes(input));
    return validateArtifactBytes(value);
  }

  agentOpenConversation(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentOpenConversation(input));
  }

  agentSendTurn(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentSendTurn(input));
  }

  agentSubscribeTurn(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentSubscribeTurn(input));
  }

  agentGetConversationSnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentGetConversationSnapshot(input));
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

  permissionPosture(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().permissionPosture(input);
  }

  permissionRequest(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().permissionRequest(input);
  }

  artifactsReadRuntimeBytes(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppArtifactBytes> {
    return this.resolve().artifactsReadRuntimeBytes(input);
  }

  agentOpenConversation(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().agentOpenConversation(input);
  }

  agentSendTurn(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().agentSendTurn(input);
  }

  agentSubscribeTurn(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().agentSubscribeTurn(input);
  }

  agentGetConversationSnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().agentGetConversationSnapshot(input);
  }
}

export function createNimiElectronLocalAppHost(): NimiElectronLocalAppHost {
  return new LazyElectronLocalAppHost();
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
  throw new NimiElectronLocalAppHostError('protected-carrier-required', false);
}

function loadPlatformBinding(): NimiElectronProtectedLocalBinding {
  const packageName = resolveNimiElectronProtectedLocalBindingPackage(process.platform, process.arch);
  try {
    return validateBinding(createRequire(import.meta.url)(packageName) as unknown);
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
    throw new NimiElectronLocalAppHostError(reasonCode, outcome.retryable);
  }
  if (outcome?.status !== 'ok' || !Object.hasOwn(outcome, 'value')) throw untrustedRuntimeError();
  return outcome.value;
}

async function invokeRecord(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  return validateProjection(await invoke(call));
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

function validateArtifactBytes(value: unknown): NimiElectronLocalAppArtifactBytes {
  if (!isPlainRecord(value)) throw untrustedRuntimeError();
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['bytes', 'mimeInferred', 'mimeType', 'sizeBytes'])) {
    throw untrustedRuntimeError();
  }
  const bytes = value.bytes;
  const mimeType = typeof value.mimeType === 'string' ? value.mimeType : '';
  const sizeBytes = Number(value.sizeBytes);
  if (
    !isUint8Array(bytes)
    || !Number.isSafeInteger(sizeBytes)
    || sizeBytes < 0
    || bytes.byteLength !== sizeBytes
    || !mimeType
    || mimeType.trim() !== mimeType
    || !mimeType.includes('/')
    || typeof value.mimeInferred !== 'boolean'
  ) {
    throw untrustedRuntimeError();
  }
  return { bytes, mimeType, sizeBytes, mimeInferred: value.mimeInferred };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isUint8Array(value: unknown): value is Uint8Array {
  return Object.prototype.toString.call(value) === '[object Uint8Array]';
}

function untrustedRuntimeError(): NimiElectronLocalAppHostError {
  return new NimiElectronLocalAppHostError('runtime-service-untrusted', false);
}

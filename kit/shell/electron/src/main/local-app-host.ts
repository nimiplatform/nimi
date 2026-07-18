import { createRequire } from 'node:module';

const WINDOWS_X64_BINDING_PACKAGE = '@nimiplatform/kit-protected-local-win32-x64';

const LOCAL_APP_BINDING_METHODS = [
  'localAppSessionStatus',
  'localAppPermissionStatus',
  'localAppPermissionRequest',
  'localAppStorageReadJson',
  'localAppStorageWriteJson',
  'localAppStorageRemoveJson',
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
  'permission-unavailable',
  'request-pending',
  'runtime-permission-denied',
  'invalid-payload',
  'not-found',
  'resource-exhausted',
  'invalid-path',
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

type NativeLocalAppOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'error'; readonly reasonCode: string; readonly retryable: boolean };

export type NimiElectronProtectedLocalBinding = {
  readonly localAppSessionStatus: () => Promise<NativeLocalAppOutcome>;
  readonly localAppPermissionStatus: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppPermissionRequest: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppStorageReadJson: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppStorageWriteJson: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppStorageRemoveJson: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
};

export type NimiElectronLocalAppHost = {
  readonly sessionStatus: () => Promise<NimiElectronLocalAppRecord>;
  readonly permissionStatus: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly permissionRequest: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly storageReadJson: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly storageWriteJson: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly storageRemoveJson: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
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

  permissionStatus(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppPermissionStatus(input));
  }

  permissionRequest(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppPermissionRequest(input));
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

  permissionStatus(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().permissionStatus(input);
  }

  permissionRequest(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().permissionRequest(input);
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

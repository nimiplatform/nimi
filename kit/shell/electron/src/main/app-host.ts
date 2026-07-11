import { createRequire } from 'node:module';

const MAX_INLINE_ARTIFACT_BYTES = 32 * 1024 * 1024;
const WINDOWS_X64_BINDING_PACKAGE = '@nimiplatform/kit-protected-local-win32-x64';

const HOST_REASON_CODES: ReadonlySet<string> = new Set([
  'protected-carrier-required',
  'runtime-service-unavailable',
  'runtime-service-untrusted',
  'runtime-service-repair-required',
  'principal-unauthorized',
  'local-development-authorization-required',
  'local-development-reapproval-required',
  'local-development-project-changed',
  'local-development-supervisor-required',
  'local-development-session-revoked',
  'local-development-platform-unsupported',
  'local-development-operation-forbidden',
  'local-development-dev-server-uncontrolled',
  'local-development-approval-denied',
] as const);

const ARTIFACT_REASON_CODES = new Set([
  'installed-artifact-invalid-input',
  'installed-artifact-forbidden',
  'installed-artifact-not-found',
  'installed-artifact-too-large',
  'installed-artifact-runtime-unavailable',
  'installed-artifact-runtime-untrusted',
] as const);

export const NIMI_ELECTRON_APP_HOST_BOOTSTRAP_COMMAND = 'nimi.app-host.bootstrap';

export type NimiElectronAppHostBootstrap = {
  readonly state: 'ready';
  readonly trustClass: 'production-installed' | 'local-development';
  readonly appId: string;
  readonly bootstrapArtifactId?: string;
  readonly expiresAtUnixMs: number;
};

export type NimiElectronAppHostArtifactBytes = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly mimeInferred: boolean;
};

export type NimiElectronAppHost = {
  readonly bootstrap: () => Promise<NimiElectronAppHostBootstrap>;
  readonly readArtifactBytes: (artifactId: string) => Promise<NimiElectronAppHostArtifactBytes>;
};

export class NimiElectronAppHostError extends Error {
  readonly reasonCode: string;
  readonly retryable: boolean;

  constructor(reasonCode: string, retryable: boolean) {
    super(reasonCode);
    this.name = 'NimiElectronAppHostError';
    this.reasonCode = reasonCode;
    this.retryable = retryable;
  }
}

type NativeBootstrapOutcome =
  | ({ readonly status: 'ok' } & NimiElectronAppHostBootstrap)
  | {
      readonly status: 'error';
      readonly reasonCode: string;
      readonly retryable: boolean;
    };

type NativeArtifactReadOutcome =
  | ({ readonly status: 'ok' } & NimiElectronAppHostArtifactBytes)
  | {
      readonly status: 'error';
      readonly reasonCode: string;
      readonly retryable: boolean;
    };

export type NimiElectronProtectedLocalBinding = {
  readonly openAppHostSession: () => Promise<NativeBootstrapOutcome>;
  readonly getAppHostSessionStatus: () => Promise<NativeBootstrapOutcome>;
  readonly readAppHostArtifactBytes: (artifactId: string) => Promise<NativeArtifactReadOutcome>;
};

class ElectronAppHost implements NimiElectronAppHost {
  private sessionReady = false;
  private sessionOpening: Promise<NimiElectronAppHostBootstrap> | undefined;

  constructor(private readonly binding: NimiElectronProtectedLocalBinding) {}

  async bootstrap(): Promise<NimiElectronAppHostBootstrap> {
    if (!this.sessionReady) {
      return this.ensureSessionOpen();
    }
    let outcome: NativeBootstrapOutcome;
    try {
      outcome = await this.binding.getAppHostSessionStatus();
    } catch {
      this.sessionReady = false;
      throw untrustedRuntimeError();
    }
    if (outcome?.status === 'error') {
      this.sessionReady = false;
      if (!HOST_REASON_CODES.has(outcome.reasonCode) || typeof outcome.retryable !== 'boolean') {
        throw untrustedRuntimeError();
      }
      return this.ensureSessionOpen();
    }
    try {
      return validateBootstrapOutcome(outcome);
    } catch (error) {
      this.sessionReady = false;
      throw error;
    }
  }

  async readArtifactBytes(artifactId: string): Promise<NimiElectronAppHostArtifactBytes> {
    const normalizedArtifactId = normalizeArtifactId(artifactId);
    await this.bootstrap();
    const outcome = await this.binding.readAppHostArtifactBytes(normalizedArtifactId);
    if (outcome?.status === 'error') {
      this.sessionReady = false;
    }
    return validateArtifactReadOutcome(outcome);
  }

  private async openSession(): Promise<NimiElectronAppHostBootstrap> {
    let outcome: NativeBootstrapOutcome;
    try {
      outcome = await this.binding.openAppHostSession();
    } catch {
      throw untrustedRuntimeError();
    }
    if (outcome?.status === 'error') {
      throw typedNativeError(outcome, HOST_REASON_CODES);
    }
    return validateBootstrapOutcome(outcome);
  }

  private async ensureSessionOpen(): Promise<NimiElectronAppHostBootstrap> {
    if (!this.sessionOpening) {
      this.sessionOpening = this.openSession();
    }
    const opening = this.sessionOpening;
    try {
      const opened = await opening;
      this.sessionReady = true;
      return opened;
    } finally {
      if (this.sessionOpening === opening) {
        this.sessionOpening = undefined;
      }
    }
  }
}

class LazyElectronAppHost implements NimiElectronAppHost {
  private host: NimiElectronAppHost | undefined;

  async bootstrap(): Promise<NimiElectronAppHostBootstrap> {
    this.host ??= new ElectronAppHost(loadPlatformBinding());
    return this.host.bootstrap();
  }

  async readArtifactBytes(artifactId: string): Promise<NimiElectronAppHostArtifactBytes> {
    this.host ??= new ElectronAppHost(loadPlatformBinding());
    return this.host.readArtifactBytes(artifactId);
  }
}

export function createNimiElectronAppHost(): NimiElectronAppHost {
  return new LazyElectronAppHost();
}

/** @internal Focused contract-test seam; not re-exported from the public main entrypoint. */
export function createNimiElectronAppHostForBinding(
  binding: NimiElectronProtectedLocalBinding,
): NimiElectronAppHost {
  return new ElectronAppHost(validateBinding(binding));
}

/** @internal Platform-package resolver used by release and fail-closed tests. */
export function resolveNimiElectronProtectedLocalBindingPackage(
  platform: string,
  architecture: string,
): string {
  if (platform === 'win32' && architecture === 'x64') {
    return WINDOWS_X64_BINDING_PACKAGE;
  }
  throw new NimiElectronAppHostError('protected-carrier-required', false);
}

function loadPlatformBinding(): NimiElectronProtectedLocalBinding {
  const packageName = resolveNimiElectronProtectedLocalBindingPackage(process.platform, process.arch);
  try {
    const loaded = createRequire(import.meta.url)(packageName) as unknown;
    return validateBinding(loaded);
  } catch (error) {
    if (error instanceof NimiElectronAppHostError) {
      throw error;
    }
    throw new NimiElectronAppHostError('protected-carrier-required', false);
  }
}

function validateBinding(value: unknown): NimiElectronProtectedLocalBinding {
  if (!value || typeof value !== 'object') {
    throw untrustedRuntimeError();
  }
  const candidate = value as Partial<NimiElectronProtectedLocalBinding>;
  if (
    typeof candidate.openAppHostSession !== 'function'
    || typeof candidate.getAppHostSessionStatus !== 'function'
    || typeof candidate.readAppHostArtifactBytes !== 'function'
  ) {
    throw untrustedRuntimeError();
  }
  return candidate as NimiElectronProtectedLocalBinding;
}

function validateBootstrapOutcome(outcome: NativeBootstrapOutcome): NimiElectronAppHostBootstrap {
  if (outcome?.status !== 'ok') {
    throw untrustedRuntimeError();
  }
  const appId = typeof outcome.appId === 'string' ? outcome.appId : '';
  const expiresAtUnixMs = Number(outcome.expiresAtUnixMs);
  const bootstrapArtifactId = typeof outcome.bootstrapArtifactId === 'string'
    ? outcome.bootstrapArtifactId
    : undefined;
  if (
    outcome.state !== 'ready'
    || !['production-installed', 'local-development'].includes(outcome.trustClass)
    || !appId
    || appId.trim() !== appId
    || !Number.isSafeInteger(expiresAtUnixMs)
    || expiresAtUnixMs <= 0
    || (outcome.trustClass === 'local-development'
      ? !bootstrapArtifactId || bootstrapArtifactId.trim() !== bootstrapArtifactId
      : bootstrapArtifactId !== undefined)
  ) {
    throw untrustedRuntimeError();
  }
  return Object.freeze({
    state: 'ready' as const,
    trustClass: outcome.trustClass,
    appId,
    ...(bootstrapArtifactId ? { bootstrapArtifactId } : {}),
    expiresAtUnixMs,
  });
}

function normalizeArtifactId(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new NimiElectronAppHostError('installed-artifact-invalid-input', false);
  }
  return value;
}

function validateArtifactReadOutcome(outcome: NativeArtifactReadOutcome): NimiElectronAppHostArtifactBytes {
  if (outcome?.status === 'error') {
    throw typedNativeError(outcome, ARTIFACT_REASON_CODES);
  }
  if (outcome?.status !== 'ok') {
    throw untrustedRuntimeError();
  }
  const mimeType = typeof outcome.mimeType === 'string' ? outcome.mimeType : '';
  if (
    !isUint8Array(outcome.bytes)
    || !Number.isSafeInteger(outcome.sizeBytes)
    || outcome.sizeBytes < 0
    || outcome.sizeBytes > MAX_INLINE_ARTIFACT_BYTES
    || outcome.bytes.byteLength !== outcome.sizeBytes
    || mimeType.length === 0
    || mimeType.trim() !== mimeType
    || !mimeType.includes('/')
    || typeof outcome.mimeInferred !== 'boolean'
  ) {
    throw untrustedRuntimeError();
  }
  return {
    bytes: outcome.bytes,
    mimeType,
    sizeBytes: outcome.sizeBytes,
    mimeInferred: outcome.mimeInferred,
  };
}

function isUint8Array(value: unknown): value is Uint8Array {
  return Object.prototype.toString.call(value) === '[object Uint8Array]';
}

function typedNativeError(
  outcome: { readonly reasonCode: string; readonly retryable: boolean },
  admittedReasons: ReadonlySet<string>,
): NimiElectronAppHostError {
  if (!admittedReasons.has(outcome.reasonCode) || typeof outcome.retryable !== 'boolean') {
    return untrustedRuntimeError();
  }
  return new NimiElectronAppHostError(outcome.reasonCode, outcome.retryable);
}

function untrustedRuntimeError(): NimiElectronAppHostError {
  return new NimiElectronAppHostError('runtime-service-untrusted', false);
}

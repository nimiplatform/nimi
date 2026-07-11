import { createRequire } from 'node:module';

const MAX_INLINE_ARTIFACT_BYTES = 32 * 1024 * 1024;
const WINDOWS_X64_BINDING_PACKAGE = '@nimiplatform/kit-protected-local-win32-x64';

const CARRIER_REASON_CODES = new Set([
  'protected-carrier-required',
  'runtime-service-unavailable',
  'runtime-service-untrusted',
  'runtime-service-repair-required',
] as const);

const ARTIFACT_REASON_CODES = new Set([
  'installed-artifact-invalid-input',
  'installed-artifact-forbidden',
  'installed-artifact-not-found',
  'installed-artifact-too-large',
  'installed-artifact-runtime-unavailable',
  'installed-artifact-runtime-untrusted',
] as const);

export type NimiElectronInstalledArtifactBytes = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly mimeInferred: boolean;
};

export type NimiElectronInstalledHost = {
  readonly readArtifactBytes: (artifactId: string) => Promise<NimiElectronInstalledArtifactBytes>;
};

export class NimiElectronInstalledHostError extends Error {
  readonly reasonCode: string;
  readonly retryable: boolean;

  constructor(reasonCode: string, retryable: boolean) {
    super(reasonCode);
    this.name = 'NimiElectronInstalledHostError';
    this.reasonCode = reasonCode;
    this.retryable = retryable;
  }
}

type NativeOpenOutcome =
  | { readonly status: 'ok' }
  | {
      readonly status: 'error';
      readonly reasonCode: string;
      readonly retryable: boolean;
    };

type NativeArtifactReadOutcome =
  | ({ readonly status: 'ok' } & NimiElectronInstalledArtifactBytes)
  | {
      readonly status: 'error';
      readonly reasonCode: string;
      readonly retryable: boolean;
    };

export type NimiElectronProtectedLocalBinding = {
  readonly openInstalledAppSession: () => Promise<NativeOpenOutcome>;
  readonly readInstalledArtifactBytes: (artifactId: string) => Promise<NativeArtifactReadOutcome>;
};

class ElectronInstalledHost implements NimiElectronInstalledHost {
  private sessionReady = false;
  private sessionOpening: Promise<void> | undefined;

  constructor(private readonly binding: NimiElectronProtectedLocalBinding) {}

  async readArtifactBytes(artifactId: string): Promise<NimiElectronInstalledArtifactBytes> {
    const normalizedArtifactId = normalizeArtifactId(artifactId);
    await this.ensureSession();
    const outcome = await this.binding.readInstalledArtifactBytes(normalizedArtifactId);
    return validateArtifactReadOutcome(outcome);
  }

  private async ensureSession(): Promise<void> {
    if (this.sessionReady) {
      return;
    }
    if (!this.sessionOpening) {
      this.sessionOpening = this.openSession();
    }
    try {
      await this.sessionOpening;
    } finally {
      if (!this.sessionReady) {
        this.sessionOpening = undefined;
      }
    }
  }

  private async openSession(): Promise<void> {
    const outcome = await this.binding.openInstalledAppSession();
    if (outcome?.status === 'ok') {
      this.sessionReady = true;
      return;
    }
    if (outcome?.status === 'error') {
      throw typedNativeError(outcome, CARRIER_REASON_CODES);
    }
    throw untrustedRuntimeError();
  }
}

class LazyElectronInstalledHost implements NimiElectronInstalledHost {
  private host: NimiElectronInstalledHost | undefined;

  async readArtifactBytes(artifactId: string): Promise<NimiElectronInstalledArtifactBytes> {
    this.host ??= new ElectronInstalledHost(loadPlatformBinding());
    return this.host.readArtifactBytes(artifactId);
  }
}

export function createNimiElectronInstalledHost(): NimiElectronInstalledHost {
  return new LazyElectronInstalledHost();
}

/** @internal Focused contract-test seam; not re-exported from the public main entrypoint. */
export function createNimiElectronInstalledHostForBinding(
  binding: NimiElectronProtectedLocalBinding,
): NimiElectronInstalledHost {
  return new ElectronInstalledHost(validateBinding(binding));
}

/** @internal Platform-package resolver used by release and fail-closed tests. */
export function resolveNimiElectronProtectedLocalBindingPackage(
  platform: string,
  architecture: string,
): string {
  if (platform === 'win32' && architecture === 'x64') {
    return WINDOWS_X64_BINDING_PACKAGE;
  }
  throw new NimiElectronInstalledHostError('protected-carrier-required', false);
}

function loadPlatformBinding(): NimiElectronProtectedLocalBinding {
  const packageName = resolveNimiElectronProtectedLocalBindingPackage(process.platform, process.arch);
  try {
    const loaded = createRequire(import.meta.url)(packageName) as unknown;
    return validateBinding(loaded);
  } catch (error) {
    if (error instanceof NimiElectronInstalledHostError) {
      throw error;
    }
    throw new NimiElectronInstalledHostError('protected-carrier-required', false);
  }
}

function validateBinding(value: unknown): NimiElectronProtectedLocalBinding {
  if (!value || typeof value !== 'object') {
    throw untrustedRuntimeError();
  }
  const candidate = value as Partial<NimiElectronProtectedLocalBinding>;
  if (
    typeof candidate.openInstalledAppSession !== 'function'
    || typeof candidate.readInstalledArtifactBytes !== 'function'
  ) {
    throw untrustedRuntimeError();
  }
  return candidate as NimiElectronProtectedLocalBinding;
}

function normalizeArtifactId(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new NimiElectronInstalledHostError('installed-artifact-invalid-input', false);
  }
  return value;
}

function validateArtifactReadOutcome(outcome: NativeArtifactReadOutcome): NimiElectronInstalledArtifactBytes {
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
): NimiElectronInstalledHostError {
  if (!admittedReasons.has(outcome.reasonCode) || typeof outcome.retryable !== 'boolean') {
    return untrustedRuntimeError();
  }
  return new NimiElectronInstalledHostError(outcome.reasonCode, outcome.retryable);
}

function untrustedRuntimeError(): NimiElectronInstalledHostError {
  return new NimiElectronInstalledHostError('runtime-service-untrusted', false);
}

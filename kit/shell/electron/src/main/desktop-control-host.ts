import { resolveNimiElectronProtectedLocalBindingPackage } from './local-app-host.js';
import { loadNimiElectronProtectedLocalPackage } from './protected-local-binding-loader.js';
import type { RuntimeGrpcBridgeStream, RuntimeGrpcBridgeStreamHandlers } from './types.js';
import {
  isNimiElectronBundledAvatarServerStreamMethod,
  isNimiElectronBundledAvatarUnaryMethod,
} from './bundled-avatar-profile.generated.js';
import {
  isNimiElectronDesktopAccountProductMethod,
  isNimiElectronDesktopMachineProductMethod,
} from './first-party-protected-runtime-profiles.generated.js';

type NativeBytesOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | {
      readonly status: 'error';
      readonly reasonCode: unknown;
      readonly retryable: unknown;
      readonly reasonMetadata?: unknown;
    };

type NativeJsonOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | {
      readonly status: 'error';
      readonly reasonCode: unknown;
      readonly retryable: unknown;
      readonly reasonMetadata?: unknown;
    };

type NativeStreamNextOutcome = {
  readonly status: 'ok' | 'error';
  readonly value?: unknown;
  readonly completed?: unknown;
  readonly reasonCode?: unknown;
  readonly retryable?: unknown;
  readonly reasonMetadata?: unknown;
};

type NimiElectronDesktopControlUnaryInput = {
  readonly methodId: string;
  readonly requestBytes: Uint8Array;
  readonly timeoutMs?: number;
  readonly requestId?: string;
  readonly signal?: AbortSignal;
};

type NativeFirstPartyProductUnaryInput = {
  readonly methodId: string;
  readonly requestBytes: Uint8Array;
  readonly timeoutMs?: number;
  readonly requestId: string;
};

type NimiElectronDesktopControlClientStreamInput = {
  readonly methodId: string;
  readonly requestFrames: readonly Uint8Array[];
  readonly timeoutMs?: number;
};

export type NimiElectronDesktopControlBinding = {
  readonly desktopMachineProductUnary: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
    readonly requestId: string;
  }) => Promise<NativeBytesOutcome>;
  readonly desktopAccountProductUnary: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
    readonly requestId: string;
  }) => Promise<NativeBytesOutcome>;
  readonly desktopFirstPartyProductUnaryCancel: (input: {
    readonly requestId: string;
  }) => Promise<NativeJsonOutcome>;
  readonly desktopFirstPartyProductUnaryRelease: (input: {
    readonly requestId: string;
  }) => Promise<NativeJsonOutcome>;
  readonly desktopAccountProductClientStream: (input: {
    readonly methodId: string;
    readonly requestFrames: readonly Uint8Array[];
    readonly timeoutMs?: number;
  }) => Promise<NativeBytesOutcome>;
  readonly desktopMachineProductStreamOpen: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }) => Promise<NativeJsonOutcome>;
  readonly desktopAccountProductStreamOpen: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }) => Promise<NativeJsonOutcome>;
  readonly desktopFirstPartyProductStreamNext: (input: { readonly streamId: string }) => Promise<NativeStreamNextOutcome>;
  readonly desktopFirstPartyProductStreamClose: (input: { readonly streamId: string }) => Promise<NativeJsonOutcome>;
  readonly desktopBundledAvatarUnary: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
    readonly requestId: string;
  }) => Promise<NativeBytesOutcome>;
  readonly desktopBundledAvatarClientStream: (input: {
    readonly methodId: string;
    readonly requestFrames: readonly Uint8Array[];
    readonly timeoutMs?: number;
  }) => Promise<NativeBytesOutcome>;
  readonly desktopBundledAvatarStreamOpen: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }) => Promise<NativeJsonOutcome>;
  readonly desktopBundledAvatarStreamNext: (input: { readonly streamId: string }) => Promise<NativeStreamNextOutcome>;
  readonly desktopBundledAvatarStreamClose: (input: { readonly streamId: string }) => Promise<NativeJsonOutcome>;
};

/** Main-process-only lifetime of the actual protected native stream. */
export type NimiElectronDesktopControlStream = RuntimeGrpcBridgeStream & {
  /** Native Open settled and its receiver reached EOF or acknowledged Close.
   * Rejection means closure was not confirmed and must block scope rebind. */
  readonly closed: Promise<void>;
};

export type NimiElectronDesktopControlHost = {
  readonly machineProductUnary: (input: NimiElectronDesktopControlUnaryInput) => Promise<Uint8Array>;
  readonly accountProductUnary: (input: NimiElectronDesktopControlUnaryInput) => Promise<Uint8Array>;
  readonly machineProductServerStream: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }) => NimiElectronDesktopControlStream;
  readonly accountProductServerStream: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }) => NimiElectronDesktopControlStream;
  readonly accountProductClientStream: (
    input: NimiElectronDesktopControlClientStreamInput,
  ) => Promise<Uint8Array>;
  readonly bundledAvatarUnary: (input: NimiElectronDesktopControlUnaryInput) => Promise<Uint8Array>;
  readonly bundledAvatarServerStream: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }) => NimiElectronDesktopControlStream;
  readonly bundledAvatarClientStream: (
    input: NimiElectronDesktopControlClientStreamInput,
  ) => Promise<Uint8Array>;
};

export class NimiElectronDesktopControlHostError extends Error {
  readonly reasonCode: string;
  readonly retryable: boolean;
  readonly reasonMetadata: Readonly<Record<string, string>>;

  constructor(
    reasonCode: string,
    retryable: boolean,
    reasonMetadata: Readonly<Record<string, string>> = {},
  ) {
    super(reasonCode);
    this.name = 'NimiElectronDesktopControlHostError';
    this.reasonCode = reasonCode;
    this.retryable = retryable;
    this.reasonMetadata = Object.freeze({ ...reasonMetadata });
  }
}

class ElectronDesktopControlHost implements NimiElectronDesktopControlHost {
  constructor(private readonly binding: NimiElectronDesktopControlBinding) {}

  async machineProductUnary(input: NimiElectronDesktopControlUnaryInput): Promise<Uint8Array> {
    if (!isNimiElectronDesktopMachineProductMethod(input.methodId, 'unary')) throw untrusted();
    return this.invokeFirstPartyUnary('machine', input, (nativeInput) => this.binding.desktopMachineProductUnary(nativeInput));
  }

  async accountProductUnary(input: NimiElectronDesktopControlUnaryInput): Promise<Uint8Array> {
    if (!isNimiElectronDesktopAccountProductMethod(input.methodId, 'unary')) throw untrusted();
    return this.invokeFirstPartyUnary('account', input, (nativeInput) => this.binding.desktopAccountProductUnary(nativeInput));
  }

  machineProductServerStream(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): NimiElectronDesktopControlStream {
    if (!isNimiElectronDesktopMachineProductMethod(input.methodId, 'server_stream')) throw untrusted();
    return new ElectronFirstPartyProductStream(this.binding, input, 'machine');
  }

  accountProductServerStream(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): NimiElectronDesktopControlStream {
    if (!isNimiElectronDesktopAccountProductMethod(input.methodId, 'server_stream')) throw untrusted();
    return new ElectronFirstPartyProductStream(this.binding, input, 'account');
  }

  async accountProductClientStream(
    input: NimiElectronDesktopControlClientStreamInput,
  ): Promise<Uint8Array> {
    validateClientStreamInput(input);
    if (input.methodId !== '/nimi.runtime.v1.RuntimeAppService/WriteLocalAppAsset'
      || !isNimiElectronDesktopAccountProductMethod(input.methodId, 'server_stream')) throw untrusted();
    return this.invokeNative(() => this.binding.desktopAccountProductClientStream(input));
  }

  async bundledAvatarUnary(input: NimiElectronDesktopControlUnaryInput): Promise<Uint8Array> {
    if (!isNimiElectronBundledAvatarUnaryMethod(input.methodId)) throw untrusted();
    return this.invokeFirstPartyUnary('avatar', input, (nativeInput) => this.binding.desktopBundledAvatarUnary(nativeInput));
  }

  bundledAvatarServerStream(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): NimiElectronDesktopControlStream {
    if (!isNimiElectronBundledAvatarServerStreamMethod(input.methodId)) throw untrusted();
    return new ElectronBundledAvatarStream(this.binding, input);
  }

  async bundledAvatarClientStream(
    input: NimiElectronDesktopControlClientStreamInput,
  ): Promise<Uint8Array> {
    validateClientStreamInput(input);
    if (input.methodId !== '/nimi.runtime.v1.RuntimeAppService/WriteLocalAppAsset'
      || !isNimiElectronBundledAvatarServerStreamMethod(input.methodId)) throw untrusted();
    return this.invokeNative(() => this.binding.desktopBundledAvatarClientStream(input));
  }

  private async invokeNative(invoke: () => Promise<NativeBytesOutcome>): Promise<Uint8Array> {
    let outcome: NativeBytesOutcome;
    try {
      outcome = await invoke();
    } catch {
      throw untrusted();
    }
    if (outcome?.status === 'error') {
      if (typeof outcome.reasonCode !== 'string'
        || !isBoundedReasonCode(outcome.reasonCode)
        || typeof outcome.retryable !== 'boolean') {
        throw untrusted();
      }
      throw new NimiElectronDesktopControlHostError(
        outcome.reasonCode,
        outcome.retryable,
        boundedReasonMetadata(outcome.reasonMetadata, outcome.reasonCode),
      );
    }
    if (outcome?.status !== 'ok' || !isUint8Array(outcome.value)) {
      throw untrusted();
    }
    return Uint8Array.from(outcome.value);
  }

  private async invokeFirstPartyUnary(
    owner: 'machine' | 'account' | 'avatar',
    input: NimiElectronDesktopControlUnaryInput,
    invoke: (nativeInput: NativeFirstPartyProductUnaryInput) => Promise<NativeBytesOutcome>,
  ): Promise<Uint8Array> {
    const requestId = createFirstPartyUnaryInternalRequestId(owner, input.requestId);
    if (input.signal?.aborted) {
      throw new NimiElectronDesktopControlHostError('runtime-request-canceled', false);
    }
    let cancellationCompletion: Promise<void> | undefined;
    const abort = () => {
      cancellationCompletion ??= this.binding.desktopFirstPartyProductUnaryCancel({ requestId })
        .then(() => undefined, () => undefined);
    };
    input.signal?.addEventListener('abort', abort, { once: true });
    try {
      return await this.invokeNative(() => invoke({
        methodId: input.methodId,
        requestBytes: input.requestBytes,
        timeoutMs: input.timeoutMs,
        requestId,
      }));
    } finally {
      input.signal?.removeEventListener('abort', abort);
      await cancellationCompletion;
      await this.binding.desktopFirstPartyProductUnaryRelease({ requestId }).catch(() => undefined);
    }
  }
}

class LazyElectronDesktopControlHost implements NimiElectronDesktopControlHost {
  private host: NimiElectronDesktopControlHost | undefined;

  machineProductUnary(input: NimiElectronDesktopControlUnaryInput): Promise<Uint8Array> {
    this.host ??= new ElectronDesktopControlHost(loadPlatformBinding());
    return this.host.machineProductUnary(input);
  }

  accountProductUnary(input: NimiElectronDesktopControlUnaryInput): Promise<Uint8Array> {
    this.host ??= new ElectronDesktopControlHost(loadPlatformBinding());
    return this.host.accountProductUnary(input);
  }

  machineProductServerStream(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): NimiElectronDesktopControlStream {
    this.host ??= new ElectronDesktopControlHost(loadPlatformBinding());
    return this.host.machineProductServerStream(input);
  }

  accountProductServerStream(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): NimiElectronDesktopControlStream {
    this.host ??= new ElectronDesktopControlHost(loadPlatformBinding());
    return this.host.accountProductServerStream(input);
  }

  accountProductClientStream(input: NimiElectronDesktopControlClientStreamInput): Promise<Uint8Array> {
    this.host ??= new ElectronDesktopControlHost(loadPlatformBinding());
    return this.host.accountProductClientStream(input);
  }

  bundledAvatarUnary(input: NimiElectronDesktopControlUnaryInput): Promise<Uint8Array> {
    this.host ??= new ElectronDesktopControlHost(loadPlatformBinding());
    return this.host.bundledAvatarUnary(input);
  }

  bundledAvatarServerStream(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): NimiElectronDesktopControlStream {
    this.host ??= new ElectronDesktopControlHost(loadPlatformBinding());
    return this.host.bundledAvatarServerStream(input);
  }

  bundledAvatarClientStream(input: NimiElectronDesktopControlClientStreamInput): Promise<Uint8Array> {
    this.host ??= new ElectronDesktopControlHost(loadPlatformBinding());
    return this.host.bundledAvatarClientStream(input);
  }
}

// The closed promise is evidence from native Open/Close, independent of a
// renderer decoder waking its own pending next after cancellation.
class ElectronProtectedProductStream implements NimiElectronDesktopControlStream {
  private cancelled = false;
  private started = false;
  private finished = false;
  private streamId = '';
  private closing: Promise<void> | undefined;
  private resolveClosed!: () => void;
  private rejectClosed!: (error: unknown) => void;
  readonly closed: Promise<void>;

  constructor(
    private readonly nativeOpen: () => Promise<NativeJsonOutcome>,
    private readonly nativeNext: (streamId: string) => Promise<NativeStreamNextOutcome>,
    private readonly nativeClose: (streamId: string) => Promise<NativeJsonOutcome>,
  ) {
    this.closed = new Promise<void>((resolve, reject) => { this.resolveClosed = resolve; this.rejectClosed = reject; });
    // Ordinary stream users need not observe this Host-private barrier; keep
    // rejection available to the formal owner without an unhandled rejection.
    void this.closed.catch(() => undefined);
  }

  start(handlers: RuntimeGrpcBridgeStreamHandlers): void {
    if (this.started) throw untrusted();
    this.started = true;
    if (this.cancelled) { this.confirmClosed(); return; }
    void this.pump(handlers).catch(error => this.failClosed(error));
  }

  cancel(): void {
    this.cancelled = true;
    if (this.finished) return;
    if (!this.started) { this.confirmClosed(); return; }
    if (this.streamId) void this.closeNative().catch(() => undefined);
  }

  private confirmClosed(): void { this.finished = true; this.resolveClosed(); }
  private failClosed(error: unknown): void { this.finished = true; this.rejectClosed(error); }
  private closeNative(): Promise<void> {
    this.closing ??= (async () => {
      const outcome = await this.nativeClose(this.streamId);
      if (outcome.status === 'error') throw nativeError(outcome);
      const value = outcome.value;
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== 1 || typeof (value as { closed?: unknown }).closed !== 'boolean') throw untrusted();
      this.confirmClosed();
    })().catch(error => { this.failClosed(error); throw error; });
    return this.closing;
  }

  private async pump(handlers: RuntimeGrpcBridgeStreamHandlers): Promise<void> {
    let opened: NativeJsonOutcome;
    try { opened = await this.nativeOpen(); }
    catch (error) {
      this.failClosed(error);
      if (!this.cancelled) handlers.onError(error);
      return;
    }
    if (opened.status === 'error') {
      // Native returns this only after its Open has failed without an owned receiver.
      this.confirmClosed();
      if (!this.cancelled) handlers.onError(nativeError(opened));
      return;
    }
    try { this.streamId = readStreamId(opened.value); }
    catch (error) { this.failClosed(error); if (!this.cancelled) handlers.onError(error); return; }
    if (this.cancelled) { await this.closeNative(); return; }
    try {
      while (!this.cancelled) {
        const next = await this.nativeNext(this.streamId);
        if (this.cancelled) return;
        if (next.status === 'error') throw nativeError(next);
        if (next.completed === true) {
          this.confirmClosed();
          handlers.onEnd();
          return;
        }
        if (!isUint8Array(next.value)) throw untrusted();
        handlers.onData(Uint8Array.from(next.value));
      }
    } catch (error) {
      if (!this.cancelled) handlers.onError(error);
    } finally {
      if (!this.finished) await this.closeNative();
    }
  }
}

class ElectronFirstPartyProductStream extends ElectronProtectedProductStream {
  constructor(binding: NimiElectronDesktopControlBinding, input: { readonly methodId: string; readonly requestBytes: Uint8Array; readonly timeoutMs?: number }, profile: 'machine' | 'account') {
    super(
      () => profile === 'machine' ? binding.desktopMachineProductStreamOpen(input) : binding.desktopAccountProductStreamOpen(input),
      streamId => binding.desktopFirstPartyProductStreamNext({ streamId }),
      streamId => binding.desktopFirstPartyProductStreamClose({ streamId }),
    );
  }
}

class ElectronBundledAvatarStream extends ElectronProtectedProductStream {
  constructor(binding: NimiElectronDesktopControlBinding, input: { readonly methodId: string; readonly requestBytes: Uint8Array; readonly timeoutMs?: number }) {
    super(
      () => binding.desktopBundledAvatarStreamOpen(input),
      streamId => binding.desktopBundledAvatarStreamNext({ streamId }),
      streamId => binding.desktopBundledAvatarStreamClose({ streamId }),
    );
  }
}

export function createNimiElectronDesktopControlHost(): NimiElectronDesktopControlHost {
  return new LazyElectronDesktopControlHost();
}

/** @internal Focused contract-test seam; not re-exported from the public main entrypoint. */
export function createNimiElectronDesktopControlHostForBinding(
  binding: NimiElectronDesktopControlBinding,
): NimiElectronDesktopControlHost {
  return new ElectronDesktopControlHost(validateBinding(binding));
}

export function isElectronDesktopMachineProductMethod(methodId: string, kind: 'unary' | 'server_stream'): boolean {
  return isNimiElectronDesktopMachineProductMethod(methodId, kind);
}

export function isElectronDesktopAccountProductMethod(methodId: string, kind: 'unary' | 'server_stream'): boolean {
  return isNimiElectronDesktopAccountProductMethod(methodId, kind);
}

function loadPlatformBinding(): NimiElectronDesktopControlBinding {
  try {
    const packageName = resolveNimiElectronProtectedLocalBindingPackage(process.platform, process.arch);
    return validateBinding(loadNimiElectronProtectedLocalPackage(packageName));
  } catch (error) {
    if (error instanceof NimiElectronDesktopControlHostError) throw error;
    throw new NimiElectronDesktopControlHostError('protected-carrier-required', false);
  }
}

function validateBinding(value: unknown): NimiElectronDesktopControlBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof (value as Record<string, unknown>).desktopMachineProductUnary !== 'function'
    || typeof (value as Record<string, unknown>).desktopAccountProductUnary !== 'function'
    || typeof (value as Record<string, unknown>).desktopAccountProductClientStream !== 'function'
    || typeof (value as Record<string, unknown>).desktopFirstPartyProductUnaryCancel !== 'function'
    || typeof (value as Record<string, unknown>).desktopFirstPartyProductUnaryRelease !== 'function'
    || typeof (value as Record<string, unknown>).desktopMachineProductStreamOpen !== 'function'
    || typeof (value as Record<string, unknown>).desktopAccountProductStreamOpen !== 'function'
    || typeof (value as Record<string, unknown>).desktopFirstPartyProductStreamNext !== 'function'
    || typeof (value as Record<string, unknown>).desktopFirstPartyProductStreamClose !== 'function'
    || typeof (value as Record<string, unknown>).desktopBundledAvatarUnary !== 'function'
    || typeof (value as Record<string, unknown>).desktopBundledAvatarClientStream !== 'function'
    || typeof (value as Record<string, unknown>).desktopBundledAvatarStreamOpen !== 'function'
    || typeof (value as Record<string, unknown>).desktopBundledAvatarStreamNext !== 'function'
    || typeof (value as Record<string, unknown>).desktopBundledAvatarStreamClose !== 'function') {
    throw untrusted();
  }
  return value as NimiElectronDesktopControlBinding;
}

function validateClientStreamInput(input: NimiElectronDesktopControlClientStreamInput): void {
  if (!Array.isArray(input.requestFrames) || input.requestFrames.length < 2
    || input.requestFrames.length > 65
    || input.requestFrames.some((frame) => !(frame instanceof Uint8Array) || frame.byteLength === 0)) {
    throw untrusted();
  }
  const size = input.requestFrames.reduce((total, frame) => total + frame.byteLength, 0);
  if (!Number.isSafeInteger(size) || size > 65 * 1024 * 1024) throw untrusted();
}

function nativeError(value: {
  readonly reasonCode?: unknown;
  readonly retryable?: unknown;
  readonly reasonMetadata?: unknown;
}): NimiElectronDesktopControlHostError {
  if (typeof value.reasonCode !== 'string' || !isBoundedReasonCode(value.reasonCode)
    || typeof value.retryable !== 'boolean') throw untrusted();
  return new NimiElectronDesktopControlHostError(
    value.reasonCode,
    value.retryable,
    boundedReasonMetadata(value.reasonMetadata, value.reasonCode),
  );
}

const INTEGRATION_CONNECTION_ERROR_REASONS: ReadonlySet<string> = new Set([
  'INTEGRATION_TELEGRAM_BOT_ALREADY_CONNECTED',
  'INTEGRATION_TELEGRAM_VERIFICATION_REQUIRED',
  'INTEGRATION_TELEGRAM_IDENTITY_INVALID',
  'INTEGRATION_TELEGRAM_WEBHOOK_CONFLICT',
  'INTEGRATION_NEW_TARGET_REQUIRED',
  'INTEGRATION_CREDENTIAL_UNAVAILABLE',
  'INTEGRATION_CUSTODY_UNAVAILABLE',
  'INTEGRATION_PROVIDER_REJECTED',
  'INTEGRATION_DISCOVERY_FAILED',
  'INTEGRATION_ENDPOINT_INVALID',
]);

function boundedReasonMetadata(value: unknown, reasonCode: string): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw untrusted();
  const metadata: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'integration_reason') {
      if (['LOCAL_APP_OPERATION_UNAVAILABLE', 'LOCAL_APP_OWNER_UNAVAILABLE', 'local-app-operation-unavailable', 'local-app-owner-unavailable'].includes(reasonCode)
        && typeof entry === 'string' && INTEGRATION_CONNECTION_ERROR_REASONS.has(entry)) metadata[key] = entry;
      continue;
    }
    if (!['permission_id', 'permission_reason', 'permission_admission', 'diagnostic_stage',
      'local_development_reason_code', 'local_import_reason', 'policy_reason', 'policy_revision', 'grpc_status_code', 'integration_reason'].includes(key)
      || typeof entry !== 'string'
      || entry.length === 0
      || entry.length > 2048
      || entry.trim() !== entry
      || /[\u0000-\u001f\u007f]/u.test(entry)) throw untrusted();
    metadata[key] = entry;
  }
  return Object.freeze(metadata);
}

function readStreamId(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw untrusted();
  const streamId = (value as Record<string, unknown>).streamId;
  if (typeof streamId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(streamId)) throw untrusted();
  return streamId;
}

function isBoundedReasonCode(value: string): boolean {
  return value.length > 0
    && value.length <= 128
    && /^[A-Za-z][A-Za-z0-9_-]*$/u.test(value);
}

let firstPartyUnaryRequestCounter = 0;

function createFirstPartyUnaryInternalRequestId(
  owner: 'machine' | 'account' | 'avatar',
  callerRequestId: string | undefined,
): string {
  const admittedCallerRequestId = typeof callerRequestId === 'string' ? callerRequestId.trim() : '';
  if (admittedCallerRequestId
    && (admittedCallerRequestId.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(admittedCallerRequestId))) {
    throw untrusted();
  }
  firstPartyUnaryRequestCounter += 1;
  return `desktop-protected-${owner}-unary-${Date.now()}-${firstPartyUnaryRequestCounter}`;
}

function isUint8Array(value: unknown): value is Uint8Array {
  return Object.prototype.toString.call(value) === '[object Uint8Array]';
}

function untrusted(): NimiElectronDesktopControlHostError {
  return new NimiElectronDesktopControlHostError('runtime-service-untrusted', false);
}

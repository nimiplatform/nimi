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
  readonly desktopBundledAvatarStreamOpen: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }) => Promise<NativeJsonOutcome>;
  readonly desktopBundledAvatarStreamNext: (input: { readonly streamId: string }) => Promise<NativeStreamNextOutcome>;
  readonly desktopBundledAvatarStreamClose: (input: { readonly streamId: string }) => Promise<NativeJsonOutcome>;
};

export type NimiElectronDesktopControlHost = {
  readonly machineProductUnary: (input: NimiElectronDesktopControlUnaryInput) => Promise<Uint8Array>;
  readonly accountProductUnary: (input: NimiElectronDesktopControlUnaryInput) => Promise<Uint8Array>;
  readonly machineProductServerStream: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }) => RuntimeGrpcBridgeStream;
  readonly accountProductServerStream: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }) => RuntimeGrpcBridgeStream;
  readonly bundledAvatarUnary: (input: NimiElectronDesktopControlUnaryInput) => Promise<Uint8Array>;
  readonly bundledAvatarServerStream: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }) => RuntimeGrpcBridgeStream;
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
  }): RuntimeGrpcBridgeStream {
    if (!isNimiElectronDesktopMachineProductMethod(input.methodId, 'server_stream')) throw untrusted();
    return new ElectronFirstPartyProductStream(this.binding, input, 'machine');
  }

  accountProductServerStream(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): RuntimeGrpcBridgeStream {
    if (!isNimiElectronDesktopAccountProductMethod(input.methodId, 'server_stream')) throw untrusted();
    return new ElectronFirstPartyProductStream(this.binding, input, 'account');
  }

  async bundledAvatarUnary(input: NimiElectronDesktopControlUnaryInput): Promise<Uint8Array> {
    if (!isNimiElectronBundledAvatarUnaryMethod(input.methodId)) throw untrusted();
    return this.invokeFirstPartyUnary('avatar', input, (nativeInput) => this.binding.desktopBundledAvatarUnary(nativeInput));
  }

  bundledAvatarServerStream(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): RuntimeGrpcBridgeStream {
    if (!isNimiElectronBundledAvatarServerStreamMethod(input.methodId)) throw untrusted();
    return new ElectronBundledAvatarStream(this.binding, input);
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
        boundedReasonMetadata(outcome.reasonMetadata),
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
  }): RuntimeGrpcBridgeStream {
    this.host ??= new ElectronDesktopControlHost(loadPlatformBinding());
    return this.host.machineProductServerStream(input);
  }

  accountProductServerStream(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): RuntimeGrpcBridgeStream {
    this.host ??= new ElectronDesktopControlHost(loadPlatformBinding());
    return this.host.accountProductServerStream(input);
  }

  bundledAvatarUnary(input: NimiElectronDesktopControlUnaryInput): Promise<Uint8Array> {
    this.host ??= new ElectronDesktopControlHost(loadPlatformBinding());
    return this.host.bundledAvatarUnary(input);
  }

  bundledAvatarServerStream(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): RuntimeGrpcBridgeStream {
    this.host ??= new ElectronDesktopControlHost(loadPlatformBinding());
    return this.host.bundledAvatarServerStream(input);
  }
}

class ElectronFirstPartyProductStream implements RuntimeGrpcBridgeStream {
  private cancelled = false;
  private started = false;
  private streamId = '';

  constructor(
    private readonly binding: NimiElectronDesktopControlBinding,
    private readonly input: { readonly methodId: string; readonly requestBytes: Uint8Array; readonly timeoutMs?: number },
    private readonly profile: 'machine' | 'account',
  ) {}

  start(handlers: RuntimeGrpcBridgeStreamHandlers): void {
    if (this.started) throw untrusted();
    this.started = true;
    void this.pump(handlers);
  }

  cancel(): void {
    this.cancelled = true;
    if (this.streamId) {
      void this.binding.desktopFirstPartyProductStreamClose({ streamId: this.streamId }).catch(() => undefined);
    }
  }

  private async pump(handlers: RuntimeGrpcBridgeStreamHandlers): Promise<void> {
    try {
      const opened = await (this.profile === 'machine'
        ? this.binding.desktopMachineProductStreamOpen(this.input)
        : this.binding.desktopAccountProductStreamOpen(this.input));
      if (opened.status === 'error') throw nativeError(opened);
      const streamId = readStreamId(opened.value);
      this.streamId = streamId;
      if (this.cancelled) {
        await this.binding.desktopFirstPartyProductStreamClose({ streamId }).catch(() => undefined);
        return;
      }
      while (!this.cancelled) {
        const next = await this.binding.desktopFirstPartyProductStreamNext({ streamId });
        if (next.status === 'error') throw nativeError(next);
        if (next.completed === true) {
          handlers.onEnd();
          return;
        }
        if (!isUint8Array(next.value)) throw untrusted();
        handlers.onData(Uint8Array.from(next.value));
      }
    } catch (error) {
      if (!this.cancelled) handlers.onError(error);
    }
  }
}

class ElectronBundledAvatarStream implements RuntimeGrpcBridgeStream {
  private cancelled = false;
  private started = false;
  private streamId = '';

  constructor(
    private readonly binding: NimiElectronDesktopControlBinding,
    private readonly input: { readonly methodId: string; readonly requestBytes: Uint8Array; readonly timeoutMs?: number },
  ) {}

  start(handlers: RuntimeGrpcBridgeStreamHandlers): void {
    if (this.started) throw untrusted();
    this.started = true;
    void this.pump(handlers);
  }

  cancel(): void {
    this.cancelled = true;
    if (this.streamId) {
      void this.binding.desktopBundledAvatarStreamClose({ streamId: this.streamId }).catch(() => undefined);
    }
  }

  private async pump(handlers: RuntimeGrpcBridgeStreamHandlers): Promise<void> {
    try {
      const opened = await this.binding.desktopBundledAvatarStreamOpen(this.input);
      if (opened.status === 'error') throw nativeError(opened);
      const streamId = readStreamId(opened.value);
      this.streamId = streamId;
      if (this.cancelled) {
        await this.binding.desktopBundledAvatarStreamClose({ streamId }).catch(() => undefined);
        return;
      }
      while (!this.cancelled) {
        const next = await this.binding.desktopBundledAvatarStreamNext({ streamId });
        if (next.status === 'error') throw nativeError(next);
        if (next.completed === true) {
          handlers.onEnd();
          return;
        }
        if (!isUint8Array(next.value)) throw untrusted();
        handlers.onData(Uint8Array.from(next.value));
      }
    } catch (error) {
      if (!this.cancelled) handlers.onError(error);
    }
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
    || typeof (value as Record<string, unknown>).desktopFirstPartyProductUnaryCancel !== 'function'
    || typeof (value as Record<string, unknown>).desktopFirstPartyProductUnaryRelease !== 'function'
    || typeof (value as Record<string, unknown>).desktopMachineProductStreamOpen !== 'function'
    || typeof (value as Record<string, unknown>).desktopAccountProductStreamOpen !== 'function'
    || typeof (value as Record<string, unknown>).desktopFirstPartyProductStreamNext !== 'function'
    || typeof (value as Record<string, unknown>).desktopFirstPartyProductStreamClose !== 'function'
    || typeof (value as Record<string, unknown>).desktopBundledAvatarUnary !== 'function'
    || typeof (value as Record<string, unknown>).desktopBundledAvatarStreamOpen !== 'function'
    || typeof (value as Record<string, unknown>).desktopBundledAvatarStreamNext !== 'function'
    || typeof (value as Record<string, unknown>).desktopBundledAvatarStreamClose !== 'function') {
    throw untrusted();
  }
  return value as NimiElectronDesktopControlBinding;
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
    boundedReasonMetadata(value.reasonMetadata),
  );
}

function boundedReasonMetadata(value: unknown): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw untrusted();
  const metadata: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!['permission_id', 'permission_reason', 'permission_admission', 'diagnostic_stage',
      'local_development_reason_code', 'grpc_status_code'].includes(key)
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

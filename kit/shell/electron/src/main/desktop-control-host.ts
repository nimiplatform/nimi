import { resolveNimiElectronProtectedLocalBindingPackage } from './local-app-host.js';
import { loadNimiElectronProtectedLocalPackage } from './protected-local-binding-loader.js';
import type { RuntimeGrpcBridgeStream, RuntimeGrpcBridgeStreamHandlers } from './types.js';
import {
  isNimiElectronBundledAvatarServerStreamMethod,
  isNimiElectronBundledAvatarUnaryMethod,
} from './bundled-avatar-profile.generated.js';

const DESKTOP_PRODUCT_CONTROL_METHOD_IDS: ReadonlySet<string> = new Set([
  '/nimi.runtime.v1.RuntimeLocalService/CollectDeviceProfile',
  '/nimi.runtime.v1.RuntimeLocalService/ResolveLocalEnvironmentPlan',
  '/nimi.runtime.v1.RuntimeLocalService/ListLocalEnvironmentDependencyJobs',
  '/nimi.runtime.v1.RuntimeLocalService/StartLocalEnvironmentDependencyJob',
  '/nimi.runtime.v1.RuntimeLocalService/CancelLocalEnvironmentDependencyJob',
  '/nimi.runtime.v1.RuntimeLocalService/RetryLocalEnvironmentDependencyJob',
  '/nimi.runtime.v1.RuntimeLocalService/RepairLocalEnvironmentDependency',
  '/nimi.runtime.v1.RuntimeLocalService/ResolveRuntimeBaselineReadiness',
  '/nimi.runtime.v1.RuntimeLocalService/MintRuntimeBaselineReadiness',
  '/nimi.runtime.v1.RuntimeLocalService/ResolveFirstRunExecutionEvidence',
  '/nimi.runtime.v1.RuntimeLocalService/MintFirstRunExecutionEvidence',
  '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord',
  '/nimi.runtime.v1.RuntimeLocalService/GetProductControlSelectedDataRoot',
  '/nimi.runtime.v1.RuntimeLocalService/EnsureProductControlRecordCreated',
  '/nimi.runtime.v1.RuntimeLocalService/SelectProductControlDataRoot',
  '/nimi.runtime.v1.RuntimeLocalService/SetProductControlFirstRunInstallLevel',
  '/nimi.runtime.v1.RuntimeLocalService/CompleteProductControlFirstRunDeviceEnvironmentScan',
  '/nimi.runtime.v1.RuntimeLocalService/AdmitProductControlReadyForUse',
  '/nimi.runtime.v1.RuntimeLocalService/RecordProductControlAccountDefaultProfileEvidence',
  '/nimi.runtime.v1.RuntimeLocalService/RecordProductControlFirstRunLocalAiReadyEvidence',
  '/nimi.runtime.v1.RuntimeLocalService/ReconcileProductControlFirstRunSetupState',
]);

const DESKTOP_RUNTIME_CONSUMER_METHOD_IDS: ReadonlySet<string> = new Set([
  '/nimi.runtime.v1.RuntimeLocalService/ListLocalAssets',
  '/nimi.runtime.v1.RuntimeLocalService/ListNodeCatalog',
  '/nimi.runtime.v1.RuntimeLocalService/CheckLocalAssetHealth',
  '/nimi.runtime.v1.RuntimeConnectorService/ListConnectors',
  '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
  '/nimi.runtime.v1.RuntimeAuditService/ListAIProviderHealth',
  '/nimi.runtime.v1.RuntimeAuditService/ListDesktopAuditEvents',
  '/nimi.runtime.v1.RuntimeAuditService/ListUsageStats',
  '/nimi.runtime.v1.RuntimeAiService/PeekScheduling',
  '/nimi.runtime.v1.RuntimeAiService/ExecuteScenario',
  '/nimi.runtime.v1.RuntimeAgentService/ListAgents',
]);

type NativeBytesOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'error'; readonly reasonCode: unknown; readonly retryable: unknown };

type NativeJsonOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'error'; readonly reasonCode: unknown; readonly retryable: unknown };

type NativeStreamNextOutcome = {
  readonly status: 'ok' | 'error';
  readonly value?: unknown;
  readonly completed?: unknown;
  readonly reasonCode?: unknown;
  readonly retryable?: unknown;
};

export type NimiElectronDesktopControlBinding = {
  readonly desktopProductControlUnary: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }) => Promise<NativeBytesOutcome>;
  readonly desktopRuntimeConsumerUnary: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }) => Promise<NativeBytesOutcome>;
  readonly desktopBundledAvatarUnary: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
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

export type NimiElectronDesktopControlHost = {
  readonly productControlUnary: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }) => Promise<Uint8Array>;
  readonly runtimeConsumerUnary: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }) => Promise<Uint8Array>;
  readonly bundledAvatarUnary: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }) => Promise<Uint8Array>;
  readonly bundledAvatarServerStream: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }) => RuntimeGrpcBridgeStream;
};

export class NimiElectronDesktopControlHostError extends Error {
  readonly reasonCode: string;
  readonly retryable: boolean;

  constructor(reasonCode: string, retryable: boolean) {
    super(reasonCode);
    this.name = 'NimiElectronDesktopControlHostError';
    this.reasonCode = reasonCode;
    this.retryable = retryable;
  }
}

class ElectronDesktopControlHost implements NimiElectronDesktopControlHost {
  constructor(private readonly binding: NimiElectronDesktopControlBinding) {}

  async productControlUnary(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): Promise<Uint8Array> {
    if (!isElectronDesktopProductControlMethod(input.methodId)) {
      throw untrusted();
    }
    return this.invokeNative(() => this.binding.desktopProductControlUnary(input));
  }

  async runtimeConsumerUnary(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): Promise<Uint8Array> {
    if (!isElectronDesktopRuntimeConsumerMethod(input.methodId)) {
      throw untrusted();
    }
    return this.invokeNative(() => this.binding.desktopRuntimeConsumerUnary(input));
  }

  async bundledAvatarUnary(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): Promise<Uint8Array> {
    if (!isNimiElectronBundledAvatarUnaryMethod(input.methodId)) throw untrusted();
    return this.invokeNative(() => this.binding.desktopBundledAvatarUnary(input));
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
      throw new NimiElectronDesktopControlHostError(outcome.reasonCode, outcome.retryable);
    }
    if (outcome?.status !== 'ok' || !isUint8Array(outcome.value)) {
      throw untrusted();
    }
    return Uint8Array.from(outcome.value);
  }
}

class LazyElectronDesktopControlHost implements NimiElectronDesktopControlHost {
  private host: NimiElectronDesktopControlHost | undefined;

  productControlUnary(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): Promise<Uint8Array> {
    this.host ??= new ElectronDesktopControlHost(loadPlatformBinding());
    return this.host.productControlUnary(input);
  }

  runtimeConsumerUnary(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): Promise<Uint8Array> {
    this.host ??= new ElectronDesktopControlHost(loadPlatformBinding());
    return this.host.runtimeConsumerUnary(input);
  }

  bundledAvatarUnary(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): Promise<Uint8Array> {
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

export function isElectronDesktopProductControlMethod(methodId: string): boolean {
  return DESKTOP_PRODUCT_CONTROL_METHOD_IDS.has(methodId.trim());
}

export function isElectronDesktopRuntimeConsumerMethod(methodId: string): boolean {
  return DESKTOP_RUNTIME_CONSUMER_METHOD_IDS.has(methodId.trim());
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
    || typeof (value as Record<string, unknown>).desktopProductControlUnary !== 'function'
    || typeof (value as Record<string, unknown>).desktopRuntimeConsumerUnary !== 'function'
    || typeof (value as Record<string, unknown>).desktopBundledAvatarUnary !== 'function'
    || typeof (value as Record<string, unknown>).desktopBundledAvatarStreamOpen !== 'function'
    || typeof (value as Record<string, unknown>).desktopBundledAvatarStreamNext !== 'function'
    || typeof (value as Record<string, unknown>).desktopBundledAvatarStreamClose !== 'function') {
    throw untrusted();
  }
  return value as NimiElectronDesktopControlBinding;
}

function nativeError(value: { readonly reasonCode?: unknown; readonly retryable?: unknown }): NimiElectronDesktopControlHostError {
  if (typeof value.reasonCode !== 'string' || !isBoundedReasonCode(value.reasonCode)
    || typeof value.retryable !== 'boolean') throw untrusted();
  return new NimiElectronDesktopControlHostError(value.reasonCode, value.retryable);
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

function isUint8Array(value: unknown): value is Uint8Array {
  return Object.prototype.toString.call(value) === '[object Uint8Array]';
}

function untrusted(): NimiElectronDesktopControlHostError {
  return new NimiElectronDesktopControlHostError('runtime-service-untrusted', false);
}

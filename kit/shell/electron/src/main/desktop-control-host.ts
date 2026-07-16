import { createRequire } from 'node:module';

import { resolveNimiElectronProtectedLocalBindingPackage } from './local-app-host.js';

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
  '/nimi.runtime.v1.RuntimeAuditService/ListUsageStats',
  '/nimi.runtime.v1.RuntimeAiService/PeekScheduling',
  '/nimi.runtime.v1.RuntimeAiService/ExecuteScenario',
  '/nimi.runtime.v1.RuntimeAgentService/ListAgents',
]);

type NativeBytesOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'error'; readonly reasonCode: unknown; readonly retryable: unknown };

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
    return validateBinding(createRequire(import.meta.url)(packageName) as unknown);
  } catch (error) {
    if (error instanceof NimiElectronDesktopControlHostError) throw error;
    throw new NimiElectronDesktopControlHostError('protected-carrier-required', false);
  }
}

function validateBinding(value: unknown): NimiElectronDesktopControlBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof (value as Record<string, unknown>).desktopProductControlUnary !== 'function'
    || typeof (value as Record<string, unknown>).desktopRuntimeConsumerUnary !== 'function') {
    throw untrusted();
  }
  return value as NimiElectronDesktopControlBinding;
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

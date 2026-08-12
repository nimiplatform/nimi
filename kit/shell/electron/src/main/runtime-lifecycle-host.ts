import { resolveNimiElectronProtectedLocalBindingPackage } from './local-app-host.js';
import { loadNimiElectronProtectedLocalPackage } from './protected-local-binding-loader.js';
import {
  createNimiElectronDeveloperModeStatusProbe,
  type NimiElectronDeveloperModeStatusProbe,
} from './developer-mode-host.js';
import { NimiElectronShellHostError } from './types.js';
import type {
  ElectronRuntimeBridgeCommandNames,
  NimiElectronRuntimeLifecycleProfile,
} from './types.js';

type NativeJsonOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'error'; readonly reasonCode: unknown; readonly retryable: unknown };

export type NimiElectronFixedRuntimeBinding = {
  readonly fixedRuntimeServiceStatus: () => Promise<NativeJsonOutcome>;
  readonly fixedRuntimeServiceStart: () => Promise<NativeJsonOutcome>;
  readonly fixedRuntimeServiceRestart: () => Promise<NativeJsonOutcome>;
};

export type NimiElectronFixedRuntimeLifecycleHost = {
  readonly invoke: (command: string, commandNames: ElectronRuntimeBridgeCommandNames) => Promise<unknown>;
};

export type NimiElectronRuntimeLifecycleHost = NimiElectronFixedRuntimeLifecycleHost;

class ElectronFixedRuntimeLifecycleHost implements NimiElectronFixedRuntimeLifecycleHost {
  constructor(
    private readonly binding: NimiElectronFixedRuntimeBinding,
    private readonly runtimeEndpoint: string,
  ) {}

  async invoke(command: string, commandNames: ElectronRuntimeBridgeCommandNames): Promise<unknown> {
    const method = command === commandNames.status
      ? this.binding.fixedRuntimeServiceStatus
      : command === commandNames.start
        ? this.binding.fixedRuntimeServiceStart
        : command === commandNames.restart
          ? this.binding.fixedRuntimeServiceRestart
          : undefined;
    if (!method) throw lifecycleError('runtime-service-untrusted', false, command);
    let outcome: NativeJsonOutcome;
    try {
      outcome = await method();
    } catch {
      throw lifecycleError('runtime-service-untrusted', false, command);
    }
    if (outcome?.status === 'error') {
      if (typeof outcome.reasonCode !== 'string'
        || !isBoundedReasonCode(outcome.reasonCode)
        || typeof outcome.retryable !== 'boolean') {
        throw lifecycleError('runtime-service-untrusted', false, command);
      }
      throw lifecycleError(outcome.reasonCode, outcome.retryable, command);
    }
    if (outcome?.status !== 'ok' || !isPlainRecord(outcome.value)) {
      throw lifecycleError('runtime-service-untrusted', false, command);
    }
    const state = normalizedText(outcome.value.state);
    const running = state === 'running' && outcome.value.running === true;
    const releasePosture = normalizedText(outcome.value.releasePosture);
    if (releasePosture !== 'non_release' && releasePosture !== 'release') {
      throw lifecycleError('runtime-service-untrusted', false, command);
    }
    const releaseVersion = normalizedText(outcome.value.releaseVersion);
    if (releasePosture === 'release' && !releaseVersion) {
      throw lifecycleError('runtime-service-untrusted', false, command);
    }
    return {
      running,
      managed: true,
      // Non-release fixed-service builds use the Runtime lifecycle posture
      // without claiming packaged exact-semver negotiation.
      launchMode: releasePosture === 'release' ? 'RELEASE' : 'RUNTIME',
      grpcAddr: this.runtimeEndpoint,
      ...(releaseVersion
        ? { version: releaseVersion }
        : {}),
      ...(!running && normalizedText(outcome.value.reasonCode)
        ? { lastError: normalizedText(outcome.value.reasonCode) }
        : {}),
    };
  }
}

class LazyElectronFixedRuntimeLifecycleHost implements NimiElectronFixedRuntimeLifecycleHost {
  private host: NimiElectronFixedRuntimeLifecycleHost | undefined;

  constructor(private readonly runtimeEndpoint: string) {}

  invoke(command: string, commandNames: ElectronRuntimeBridgeCommandNames): Promise<unknown> {
    this.host ??= new ElectronFixedRuntimeLifecycleHost(loadPlatformBinding(), this.runtimeEndpoint);
    return this.host.invoke(command, commandNames);
  }
}

export function createNimiElectronFixedRuntimeLifecycleHost(
  runtimeEndpoint: string,
): NimiElectronFixedRuntimeLifecycleHost {
  return new LazyElectronFixedRuntimeLifecycleHost(runtimeEndpoint);
}

class ElectronSourceRuntimeLifecycleHost implements NimiElectronRuntimeLifecycleHost {
  constructor(
    private readonly statusProbe: NimiElectronDeveloperModeStatusProbe,
    private readonly runtimeEndpoint: string,
  ) {}

  async invoke(command: string, commandNames: ElectronRuntimeBridgeCommandNames): Promise<unknown> {
    if (command === commandNames.start || command === commandNames.restart) {
      throw sourceLifecycleUnavailable(command);
    }
    if (command !== commandNames.status) {
      throw lifecycleError('runtime-service-untrusted', false, command);
    }
    await this.statusProbe.probe();
    return {
      running: true,
      managed: false,
      launchMode: 'SOURCE',
      grpcAddr: this.runtimeEndpoint,
    };
  }
}

export function createNimiElectronRuntimeLifecycleHost(
  runtimeEndpoint: string,
  runtimeLifecycleProfile: NimiElectronRuntimeLifecycleProfile = 'fixed',
): NimiElectronRuntimeLifecycleHost {
  return runtimeLifecycleProfile === 'source'
    ? new ElectronSourceRuntimeLifecycleHost(
        createNimiElectronDeveloperModeStatusProbe(),
        runtimeEndpoint,
      )
    : createNimiElectronFixedRuntimeLifecycleHost(runtimeEndpoint);
}

/** @internal Focused contract-test seam; not re-exported from the public main entrypoint. */
export function createNimiElectronFixedRuntimeLifecycleHostForBinding(
  binding: NimiElectronFixedRuntimeBinding,
  runtimeEndpoint: string,
): NimiElectronFixedRuntimeLifecycleHost {
  return new ElectronFixedRuntimeLifecycleHost(validateBinding(binding), runtimeEndpoint);
}

/** @internal Focused contract-test seam; not re-exported from the public main entrypoint. */
export function createNimiElectronSourceRuntimeLifecycleHostForProbe(
  statusProbe: NimiElectronDeveloperModeStatusProbe,
  runtimeEndpoint: string,
): NimiElectronRuntimeLifecycleHost {
  return new ElectronSourceRuntimeLifecycleHost(statusProbe, runtimeEndpoint);
}

function loadPlatformBinding(): NimiElectronFixedRuntimeBinding {
  try {
    const packageName = resolveNimiElectronProtectedLocalBindingPackage(process.platform, process.arch);
    return validateBinding(loadNimiElectronProtectedLocalPackage(packageName));
  } catch (error) {
    if (error instanceof NimiElectronShellHostError) throw error;
    throw lifecycleError('protected-carrier-required', false, 'nimi.shell.runtimeLifecycle.status');
  }
}

function validateBinding(value: unknown): NimiElectronFixedRuntimeBinding {
  if (!isPlainRecord(value)
    || typeof value.fixedRuntimeServiceStatus !== 'function'
    || typeof value.fixedRuntimeServiceStart !== 'function'
    || typeof value.fixedRuntimeServiceRestart !== 'function') {
    throw lifecycleError('runtime-service-untrusted', false, 'nimi.shell.runtimeLifecycle.status');
  }
  return value as NimiElectronFixedRuntimeBinding;
}

function lifecycleError(reasonCode: string, retryable: boolean, command: string): NimiElectronShellHostError {
  const code = reasonCode === 'protected-carrier-required'
    ? 'protected-carrier-required'
    : reasonCode === 'runtime-service-unavailable'
      ? 'runtime-service-unavailable'
      : reasonCode === 'runtime-service-repair-required'
        ? 'runtime-service-repair-required'
        : reasonCode === 'runtime-service-error-unclassified'
          ? 'runtime-service-error-unclassified'
          : 'runtime-service-untrusted';
  return new NimiElectronShellHostError({
    code,
    message: reasonCode,
    reasonCode,
    actionHint: retryable ? 'retry_fixed_runtime_service_operation' : 'repair_fixed_runtime_service',
    source: reasonCode === 'protected-carrier-required' ? 'electron' : 'runtime',
    details: { command, retryable },
  });
}

function sourceLifecycleUnavailable(command: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'runtime-service-unavailable',
    message: `Source Runtime lifecycle command is owned by the pnpm dev:runtime terminal: ${command}`,
    reasonCode: 'runtime-service-unavailable',
    actionHint: 'restart_source_runtime_from_owner_terminal',
    source: 'electron',
    details: {
      command,
      runtimeTopology: 'source-local-development',
      managedExternally: true,
      retryable: false,
    },
  });
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isBoundedReasonCode(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z][A-Za-z0-9_-]*$/u.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

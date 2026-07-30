import { resolveNimiElectronProtectedLocalBindingPackage } from './local-app-host.js';
import { asRecord } from './paths.js';
import { loadNimiElectronProtectedLocalPackage } from './protected-local-binding-loader.js';
import { NimiElectronShellHostError } from './types.js';

type DeveloperModeCommand = 'developer_mode_status' | 'developer_mode_set';
type NativeJsonOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'error'; readonly reasonCode: unknown; readonly retryable: unknown };

export type NimiElectronDeveloperModeBinding = {
  readonly desktopDeveloperModeStatus: () => Promise<NativeJsonOutcome>;
  readonly desktopDeveloperModeSet: (input: { readonly enabled: boolean }) => Promise<NativeJsonOutcome>;
};

export type NimiElectronDeveloperModeHost = {
  readonly invoke: (command: DeveloperModeCommand, payload: Readonly<Record<string, unknown>>) => Promise<unknown>;
};

class ElectronDeveloperModeHost implements NimiElectronDeveloperModeHost {
  constructor(private readonly binding: NimiElectronDeveloperModeBinding) {}

  async invoke(command: DeveloperModeCommand, payload: Readonly<Record<string, unknown>>): Promise<unknown> {
    const nested = command === 'developer_mode_set'
      ? asRecord(payload.payload, `${command} payload must be an object`)
      : undefined;
    if (nested && typeof nested.enabled !== 'boolean') {
      throw developerModeError('runtime-service-untrusted', false, command);
    }
    let outcome: NativeJsonOutcome;
    try {
      outcome = command === 'developer_mode_status'
        ? await this.binding.desktopDeveloperModeStatus()
        : await this.binding.desktopDeveloperModeSet({ enabled: nested!.enabled as boolean });
    } catch {
      throw developerModeError('runtime-service-untrusted', false, command);
    }
    if (outcome?.status === 'error') {
      if (typeof outcome.reasonCode !== 'string'
        || !isBoundedReasonCode(outcome.reasonCode)
        || typeof outcome.retryable !== 'boolean') {
        throw developerModeError('runtime-service-untrusted', false, command);
      }
      throw developerModeError(outcome.reasonCode, outcome.retryable, command);
    }
    if (outcome?.status !== 'ok' || !isPlainRecord(outcome.value)) {
      throw developerModeError('runtime-service-untrusted', false, command);
    }
    return outcome.value;
  }
}

class LazyElectronDeveloperModeHost implements NimiElectronDeveloperModeHost {
  private host: NimiElectronDeveloperModeHost | undefined;

  invoke(command: DeveloperModeCommand, payload: Readonly<Record<string, unknown>>): Promise<unknown> {
    this.host ??= new ElectronDeveloperModeHost(loadPlatformBinding());
    return this.host.invoke(command, payload);
  }
}

export function createNimiElectronDeveloperModeHost(): NimiElectronDeveloperModeHost {
  return new LazyElectronDeveloperModeHost();
}

/** @internal Focused contract-test seam; not re-exported from the public main entrypoint. */
export function createNimiElectronDeveloperModeHostForBinding(
  binding: NimiElectronDeveloperModeBinding,
): NimiElectronDeveloperModeHost {
  return new ElectronDeveloperModeHost(validateBinding(binding));
}

export function isElectronDeveloperModeCommand(command: string): command is DeveloperModeCommand {
  return command === 'developer_mode_status' || command === 'developer_mode_set';
}

function loadPlatformBinding(): NimiElectronDeveloperModeBinding {
  try {
    const packageName = resolveNimiElectronProtectedLocalBindingPackage(process.platform, process.arch);
    return validateBinding(loadNimiElectronProtectedLocalPackage(packageName));
  } catch (error) {
    if (error instanceof NimiElectronShellHostError) throw error;
    throw developerModeError('protected-carrier-required', false, 'developer_mode_status');
  }
}

function validateBinding(value: unknown): NimiElectronDeveloperModeBinding {
  if (!isPlainRecord(value)
    || typeof value.desktopDeveloperModeStatus !== 'function'
    || typeof value.desktopDeveloperModeSet !== 'function') {
    throw developerModeError('runtime-service-untrusted', false, 'developer_mode_status');
  }
  return value as NimiElectronDeveloperModeBinding;
}

function developerModeError(reasonCode: string, retryable: boolean, command: string): NimiElectronShellHostError {
  const code = reasonCode === 'protected-carrier-required'
    ? 'protected-carrier-required'
    : reasonCode === 'runtime-service-unavailable'
      ? 'runtime-service-unavailable'
      : reasonCode === 'runtime-service-repair-required'
        ? 'runtime-service-repair-required'
        : reasonCode === 'runtime-service-untrusted'
          ? 'runtime-service-untrusted'
          : reasonCode === 'runtime-service-error-unclassified'
            ? 'runtime-service-error-unclassified'
            : 'runtime-permission-denied';
  return new NimiElectronShellHostError({
    code,
    message: reasonCode,
    reasonCode,
    actionHint: retryable ? 'retry_developer_mode_operation' : 'refresh_developer_mode_projection',
    source: reasonCode === 'protected-carrier-required' ? 'electron' : 'runtime',
    details: { command, retryable },
  });
}

function isBoundedReasonCode(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z][A-Za-z0-9_-]*$/u.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

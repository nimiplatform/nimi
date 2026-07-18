import { resolveNimiElectronProtectedLocalBindingPackage } from './local-app-host.js';
import { asRecord } from './paths.js';
import { loadNimiElectronProtectedLocalPackage } from './protected-local-binding-loader.js';
import { NimiElectronShellHostError } from './types.js';

const DESKTOP_ACCOUNT_COMMANDS = [
  'runtime_account_session_status',
  'runtime_account_begin_login',
  'runtime_account_complete_login',
  'runtime_account_invoke_realm_unary',
  'runtime_account_logout',
  'runtime_account_switch_account',
] as const;

type DesktopAccountCommand = typeof DESKTOP_ACCOUNT_COMMANDS[number];
type NativeJsonOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'error'; readonly reasonCode: unknown; readonly retryable: unknown };

export type NimiElectronDesktopAccountBinding = {
  readonly desktopAccountSessionStatus: () => Promise<NativeJsonOutcome>;
  readonly desktopAccountBeginLogin: (input: unknown) => Promise<NativeJsonOutcome>;
  readonly desktopAccountCompleteLogin: (input: unknown) => Promise<NativeJsonOutcome>;
  readonly desktopAccountInvokeRealmUnary: (input: unknown) => Promise<NativeJsonOutcome>;
  readonly desktopAccountLogout: (input: unknown) => Promise<NativeJsonOutcome>;
  readonly desktopAccountSwitchAccount: (input: unknown) => Promise<NativeJsonOutcome>;
};

const BINDING_METHOD_BY_COMMAND: Readonly<Record<DesktopAccountCommand, keyof NimiElectronDesktopAccountBinding>> = {
  runtime_account_session_status: 'desktopAccountSessionStatus',
  runtime_account_begin_login: 'desktopAccountBeginLogin',
  runtime_account_complete_login: 'desktopAccountCompleteLogin',
  runtime_account_invoke_realm_unary: 'desktopAccountInvokeRealmUnary',
  runtime_account_logout: 'desktopAccountLogout',
  runtime_account_switch_account: 'desktopAccountSwitchAccount',
};

export type NimiElectronDesktopAccountHost = {
  readonly invoke: (command: DesktopAccountCommand, payload: Readonly<Record<string, unknown>>) => Promise<unknown>;
};

class ElectronDesktopAccountHost implements NimiElectronDesktopAccountHost {
  constructor(private readonly binding: NimiElectronDesktopAccountBinding) {}

  async invoke(command: DesktopAccountCommand, payload: Readonly<Record<string, unknown>>): Promise<unknown> {
    const method = this.binding[BINDING_METHOD_BY_COMMAND[command]] as (input?: unknown) => Promise<NativeJsonOutcome>;
    const input = command === 'runtime_account_session_status'
      ? undefined
      : asRecord(payload.payload, `${command} payload must be an object`);
    let outcome: NativeJsonOutcome;
    try {
      outcome = input === undefined ? await method() : await method(input);
    } catch {
      throw desktopAccountError('runtime-service-untrusted', false, command);
    }
    if (outcome?.status === 'error') {
      if (typeof outcome.reasonCode !== 'string'
        || !isBoundedReasonCode(outcome.reasonCode)
        || typeof outcome.retryable !== 'boolean') {
        throw desktopAccountError('runtime-service-untrusted', false, command);
      }
      throw desktopAccountError(outcome.reasonCode, outcome.retryable, command);
    }
    if (outcome?.status !== 'ok' || !isPlainRecord(outcome.value)) {
      throw desktopAccountError('runtime-service-untrusted', false, command);
    }
    return outcome.value;
  }
}

class LazyElectronDesktopAccountHost implements NimiElectronDesktopAccountHost {
  private host: NimiElectronDesktopAccountHost | undefined;

  invoke(command: DesktopAccountCommand, payload: Readonly<Record<string, unknown>>): Promise<unknown> {
    this.host ??= new ElectronDesktopAccountHost(loadPlatformBinding());
    return this.host.invoke(command, payload);
  }
}

export function createNimiElectronDesktopAccountHost(): NimiElectronDesktopAccountHost {
  return new LazyElectronDesktopAccountHost();
}

/** @internal Focused contract-test seam; not re-exported from the public main entrypoint. */
export function createNimiElectronDesktopAccountHostForBinding(
  binding: NimiElectronDesktopAccountBinding,
): NimiElectronDesktopAccountHost {
  return new ElectronDesktopAccountHost(validateBinding(binding));
}

export function isElectronDesktopAccountCommand(command: string): command is DesktopAccountCommand {
  return (DESKTOP_ACCOUNT_COMMANDS as readonly string[]).includes(command);
}

function loadPlatformBinding(): NimiElectronDesktopAccountBinding {
  try {
    const packageName = resolveNimiElectronProtectedLocalBindingPackage(process.platform, process.arch);
    return validateBinding(loadNimiElectronProtectedLocalPackage(packageName));
  } catch (error) {
    if (error instanceof NimiElectronShellHostError) throw error;
    throw desktopAccountError('protected-carrier-required', false, 'runtime_account_session_status');
  }
}

function validateBinding(value: unknown): NimiElectronDesktopAccountBinding {
  if (!isPlainRecord(value)) {
    throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_session_status');
  }
  for (const method of Object.values(BINDING_METHOD_BY_COMMAND)) {
    if (typeof value[method] !== 'function') {
      throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_session_status');
    }
  }
  return value as NimiElectronDesktopAccountBinding;
}

function desktopAccountError(reasonCode: string, retryable: boolean, command: string): NimiElectronShellHostError {
  const code = reasonCode === 'protected-carrier-required'
    ? 'protected-carrier-required'
    : reasonCode === 'runtime-service-unavailable'
      ? 'runtime-service-unavailable'
      : reasonCode === 'runtime-service-repair-required'
        ? 'runtime-service-repair-required'
        : reasonCode === 'runtime-service-untrusted'
          ? 'runtime-service-untrusted'
          : 'runtime-permission-denied';
  return new NimiElectronShellHostError({
    code,
    message: reasonCode,
    reasonCode,
    actionHint: retryable ? 'retry_protected_desktop_account_operation' : 'refresh_runtime_account_projection',
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

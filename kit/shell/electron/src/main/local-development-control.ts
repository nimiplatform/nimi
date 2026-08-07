import { resolveNimiElectronProtectedLocalBindingPackage } from './local-app-host.js';
import { loadNimiElectronProtectedLocalPackage } from './protected-local-binding-loader.js';
import { NimiElectronShellHostError } from './types.js';

type NativeJsonOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'error'; readonly reasonCode: unknown; readonly retryable: unknown };

const NATIVE_CONTROL_DEADLINE_MS = 20_000;

export type NimiElectronLocalDevelopmentShell = 'electron' | 'tauri';

export type NimiElectronLocalDevelopmentProject = {
  readonly appId: string;
  readonly displayName: string;
  readonly canonicalProjectRoot: string;
  readonly canonicalManifestPath: string;
  readonly shell: NimiElectronLocalDevelopmentShell;
  readonly appAccess: readonly string[];
  readonly sourceGeneration: number;
  readonly declarationGeneration: number;
};

export type NimiElectronLocalDevelopmentRegistration = {
  /** Main-process private management selector. Never project to a renderer. */
  readonly registrationHandle: string;
  readonly project: NimiElectronLocalDevelopmentProject;
  readonly registeredAtUnixMs: number;
  readonly updatedAtUnixMs: number;
};

export type NimiElectronLocalDevelopmentBinding = {
  readonly desktopRegisterLocalDevelopmentProject: (input: Readonly<Record<string, unknown>>) => Promise<NativeJsonOutcome>;
  readonly desktopListLocalDevelopmentRegistrations: () => Promise<NativeJsonOutcome>;
  readonly desktopRemoveLocalDevelopmentRegistration: (input: Readonly<Record<string, unknown>>) => Promise<NativeJsonOutcome>;
  readonly desktopLaunchLocalDevelopmentHost: (input: Readonly<Record<string, unknown>>) => Promise<NativeJsonOutcome>;
  readonly desktopLocalDevelopmentHostRunning: (input: Readonly<Record<string, unknown>>) => Promise<NativeJsonOutcome>;
  readonly desktopTerminateLocalDevelopmentHost: (input: Readonly<Record<string, unknown>>) => Promise<NativeJsonOutcome>;
  readonly desktopEndLocalDevelopmentRun: (input: Readonly<Record<string, unknown>>) => Promise<NativeJsonOutcome>;
};

export type NimiElectronLocalDevelopmentControl = {
  readonly register: (input: {
    readonly expectedAppId: string;
    readonly projectRoot: string;
    readonly shell: NimiElectronLocalDevelopmentShell;
    readonly supervisorRunId: string;
  }) => Promise<NimiElectronLocalDevelopmentRegistration>;
  readonly listRegistrations: () => Promise<readonly NimiElectronLocalDevelopmentRegistration[]>;
  readonly removeRegistration: (registrationHandle: string) => Promise<void>;
  readonly launch: (input: {
    readonly registrationHandle: string;
    readonly supervisorRunId: string;
    readonly shell: NimiElectronLocalDevelopmentShell;
    readonly hostExecutablePath: string;
    readonly rendererOrigin: string;
    readonly hostArguments: readonly string[];
    readonly workingDirectory: string;
  }) => Promise<{ readonly processId: number; readonly bindDeadlineUnixMs: number }>;
  readonly hostRunning: (supervisorRunId: string) => Promise<boolean>;
  readonly terminateHost: (supervisorRunId: string) => Promise<void>;
  readonly endRun: (registrationHandle: string, supervisorRunId: string) => Promise<void>;
};

class ElectronLocalDevelopmentControl implements NimiElectronLocalDevelopmentControl {
  constructor(private readonly binding: NimiElectronLocalDevelopmentBinding) {}

  async register(input: Parameters<NimiElectronLocalDevelopmentControl['register']>[0]) {
    return parseRegistration(await invokeNative(
      () => this.binding.desktopRegisterLocalDevelopmentProject({
        expectedAppId: boundedText(input.expectedAppId),
        projectRoot: boundedText(input.projectRoot),
        shell: shell(input.shell),
        supervisorRunId: identifier(input.supervisorRunId),
      }),
      'register_local_development_project',
    ));
  }

  async listRegistrations() {
    const value = await invokeNative(
      () => this.binding.desktopListLocalDevelopmentRegistrations(),
      'list_local_development_registrations',
    );
    if (!Array.isArray(value)) invalid();
    return value.map(parseRegistration);
  }

  async removeRegistration(registrationHandle: string) {
    const value = exact(await invokeNative(
      () => this.binding.desktopRemoveLocalDevelopmentRegistration({
        registrationHandle: identifier(registrationHandle),
      }),
      'remove_local_development_registration',
    ), ['removed']);
    if (value.removed !== true) invalid();
  }

  async launch(input: Parameters<NimiElectronLocalDevelopmentControl['launch']>[0]) {
    const value = exact(await invokeNative(
      () => this.binding.desktopLaunchLocalDevelopmentHost({
        registrationHandle: identifier(input.registrationHandle),
        supervisorRunId: identifier(input.supervisorRunId),
        shell: shell(input.shell),
        hostExecutablePath: boundedText(input.hostExecutablePath),
        rendererOrigin: boundedText(input.rendererOrigin),
        hostArguments: input.hostArguments.map(boundedText),
        workingDirectory: boundedText(input.workingDirectory),
      }),
      'launch_local_development_host',
    ), ['bindDeadlineUnixMs', 'processId']);
    return {
      processId: integer(value.processId, 1),
      bindDeadlineUnixMs: integer(value.bindDeadlineUnixMs, Date.now() + 1),
    };
  }

  async hostRunning(supervisorRunId: string) {
    const value = exact(await invokeNative(
      () => this.binding.desktopLocalDevelopmentHostRunning({ supervisorRunId: identifier(supervisorRunId) }),
      'local_development_host_running',
    ), ['running']);
    if (typeof value.running !== 'boolean') invalid();
    return value.running;
  }

  async terminateHost(supervisorRunId: string) {
    const value = exact(await invokeNative(
      () => this.binding.desktopTerminateLocalDevelopmentHost({ supervisorRunId: identifier(supervisorRunId) }),
      'terminate_local_development_host',
    ), ['terminated']);
    if (value.terminated !== true) invalid();
  }

  async endRun(registrationHandle: string, supervisorRunId: string) {
    const value = exact(await invokeNative(
      () => this.binding.desktopEndLocalDevelopmentRun({
        registrationHandle: identifier(registrationHandle),
        supervisorRunId: identifier(supervisorRunId),
      }),
      'end_local_development_run',
    ), ['ended']);
    if (value.ended !== true) invalid();
  }
}

class LazyElectronLocalDevelopmentControl implements NimiElectronLocalDevelopmentControl {
  private control: NimiElectronLocalDevelopmentControl | undefined;

  private resolve(): NimiElectronLocalDevelopmentControl {
    this.control ??= new ElectronLocalDevelopmentControl(loadPlatformBinding());
    return this.control;
  }

  register: NimiElectronLocalDevelopmentControl['register'] = (input) => this.resolve().register(input);
  listRegistrations: NimiElectronLocalDevelopmentControl['listRegistrations'] = () => this.resolve().listRegistrations();
  removeRegistration: NimiElectronLocalDevelopmentControl['removeRegistration'] = (handle) => this.resolve().removeRegistration(handle);
  launch: NimiElectronLocalDevelopmentControl['launch'] = (input) => this.resolve().launch(input);
  hostRunning: NimiElectronLocalDevelopmentControl['hostRunning'] = (id) => this.resolve().hostRunning(id);
  terminateHost: NimiElectronLocalDevelopmentControl['terminateHost'] = (id) => this.resolve().terminateHost(id);
  endRun: NimiElectronLocalDevelopmentControl['endRun'] = (handle, runId) => this.resolve().endRun(handle, runId);
}

export function createNimiElectronLocalDevelopmentControl(): NimiElectronLocalDevelopmentControl {
  return new LazyElectronLocalDevelopmentControl();
}

/** @internal Focused contract-test seam. */
export function createNimiElectronLocalDevelopmentControlForBinding(
  binding: NimiElectronLocalDevelopmentBinding,
): NimiElectronLocalDevelopmentControl {
  return new ElectronLocalDevelopmentControl(validateBinding(binding));
}

async function invokeNative(invoke: () => Promise<NativeJsonOutcome>, operation: string): Promise<unknown> {
  let outcome: NativeJsonOutcome;
  let timer: NodeJS.Timeout | undefined;
  try {
    outcome = await Promise.race([
      invoke(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('protected-native-control-timeout')), NATIVE_CONTROL_DEADLINE_MS);
      }),
    ]);
  } catch {
    throw controlError('runtime-service-untrusted', false, operation);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (outcome?.status === 'error') {
    if (typeof outcome.reasonCode !== 'string'
      || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(outcome.reasonCode)
      || typeof outcome.retryable !== 'boolean') {
      throw controlError('runtime-service-untrusted', false, operation);
    }
    throw controlError(outcome.reasonCode, outcome.retryable, operation);
  }
  if (outcome?.status !== 'ok') throw controlError('runtime-service-untrusted', false, operation);
  return outcome.value;
}

function parseRegistration(value: unknown): NimiElectronLocalDevelopmentRegistration {
  const row = exact(value, ['project', 'registeredAtUnixMs', 'registrationHandle', 'updatedAtUnixMs']);
  return {
    registrationHandle: identifier(row.registrationHandle),
    project: parseProject(row.project),
    registeredAtUnixMs: integer(row.registeredAtUnixMs, 1),
    updatedAtUnixMs: integer(row.updatedAtUnixMs, 1),
  };
}

function parseProject(value: unknown): NimiElectronLocalDevelopmentProject {
  const row = exact(value, [
    'appAccess', 'appId', 'canonicalManifestPath', 'canonicalProjectRoot',
    'declarationGeneration', 'displayName', 'shell', 'sourceGeneration',
  ]);
  if (!Array.isArray(row.appAccess)) invalid();
  const appAccess = row.appAccess.map(boundedText);
  return {
    appId: boundedText(row.appId),
    displayName: boundedText(row.displayName),
    canonicalProjectRoot: boundedText(row.canonicalProjectRoot),
    canonicalManifestPath: boundedText(row.canonicalManifestPath),
    shell: shell(row.shell),
    appAccess,
    sourceGeneration: integer(row.sourceGeneration, 1),
    declarationGeneration: integer(row.declarationGeneration, 1),
  };
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) invalid();
  return value;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) invalid();
  return value;
}

function boundedText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.trim() !== value) invalid();
  return value;
}

function integer(value: unknown, minimum: number): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < minimum) invalid();
  return numeric;
}

function shell(value: unknown): NimiElectronLocalDevelopmentShell {
  if (value !== 'electron' && value !== 'tauri') invalid();
  return value;
}

function validateBinding(value: unknown): NimiElectronLocalDevelopmentBinding {
  const methods = [
    'desktopRegisterLocalDevelopmentProject',
    'desktopListLocalDevelopmentRegistrations',
    'desktopRemoveLocalDevelopmentRegistration',
    'desktopLaunchLocalDevelopmentHost',
    'desktopLocalDevelopmentHostRunning',
    'desktopTerminateLocalDevelopmentHost',
    'desktopEndLocalDevelopmentRun',
  ];
  if (!isRecord(value) || methods.some((method) => typeof value[method] !== 'function')) {
    throw controlError('runtime-service-untrusted', false, 'load_local_development_control');
  }
  return value as NimiElectronLocalDevelopmentBinding;
}

function loadPlatformBinding(): NimiElectronLocalDevelopmentBinding {
  try {
    const packageName = resolveNimiElectronProtectedLocalBindingPackage(process.platform, process.arch);
    return validateBinding(loadNimiElectronProtectedLocalPackage(packageName));
  } catch (error) {
    if (error instanceof NimiElectronShellHostError) throw error;
    throw controlError('protected-carrier-required', false, 'load_local_development_control');
  }
}

function controlError(reasonCode: string, retryable: boolean, operation: string): NimiElectronShellHostError {
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
    actionHint: retryable ? 'retry_local_development_operation' : 'refresh_local_development_projection',
    source: reasonCode === 'protected-carrier-required' ? 'electron' : 'runtime',
    details: { operation, retryable },
  });
}

function invalid(): never {
  throw controlError('runtime-service-untrusted', false, 'parse_local_development_projection');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

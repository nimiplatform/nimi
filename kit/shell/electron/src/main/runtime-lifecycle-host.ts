import { execFile } from 'node:child_process';
import { lstatSync, realpathSync, type Stats } from 'node:fs';
import path from 'node:path';
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

const SOURCE_RUNTIME_VERSION_TIMEOUT_MS = 2_000;
const SOURCE_RUNTIME_VERSION_MAX_BUFFER_BYTES = 16 * 1024;
const MACOS_SOURCE_RUNTIME_RELATIVE_TAIL = [
  '.nimi',
  'local',
  'imp3',
  'runtime-local-development',
  'nimi-runtime',
] as const;
const WINDOWS_SOURCE_RUNTIME_RELATIVE_TAIL = [
  '.nimi',
  'local',
  'imp6',
  'runtime-local-development',
  'nimi.exe',
] as const;

export type NimiElectronSourceRuntimeVersionResolver = () => Promise<string | undefined>;

export type NimiElectronSourceRuntimeVersionProbeDependencies = {
  readonly platform?: NodeJS.Platform;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly geteuid?: () => number;
  readonly lstat?: (
    candidate: string,
  ) => Pick<Stats, 'isFile' | 'isSymbolicLink' | 'uid' | 'mode' | 'ino' | 'mtimeMs' | 'size'>;
  readonly realpath?: (candidate: string) => string;
  readonly execFile?: (
    file: string,
    args: readonly string[],
    options: { readonly timeout: number; readonly maxBuffer: number; readonly windowsHide: boolean },
  ) => Promise<string>;
};

type NativeJsonOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'error'; readonly reasonCode: unknown; readonly retryable: unknown };

export type NimiElectronFixedRuntimeBinding = {
  readonly fixedRuntimeServiceStatus: () => Promise<NativeJsonOutcome>;
  readonly fixedRuntimeServiceStart: () => Promise<NativeJsonOutcome>;
  readonly fixedRuntimeServiceStop: () => Promise<NativeJsonOutcome>;
  readonly fixedRuntimeServiceRestart: () => Promise<NativeJsonOutcome>;
};

export type NimiElectronFixedRuntimeLifecycleHost = {
  readonly stop: () => Promise<void>;
  readonly invoke: (command: string, commandNames: ElectronRuntimeBridgeCommandNames) => Promise<unknown>;
};

export type NimiElectronRuntimeLifecycleHost = NimiElectronFixedRuntimeLifecycleHost;

class ElectronFixedRuntimeLifecycleHost implements NimiElectronFixedRuntimeLifecycleHost {
  constructor(
    private readonly binding: NimiElectronFixedRuntimeBinding,
    private readonly runtimeEndpoint: string,
  ) {}

  // Host-only product shutdown; never a renderer lifecycle command.
  async stop(): Promise<void> {
    const outcome = await this.binding.fixedRuntimeServiceStop();
    if (outcome?.status === 'error' && typeof outcome.reasonCode === 'string'
      && isBoundedReasonCode(outcome.reasonCode) && typeof outcome.retryable === 'boolean') {
      throw lifecycleError(outcome.reasonCode, outcome.retryable, 'product-runtime-stop');
    }
    if (outcome?.status !== 'ok' || !isPlainRecord(outcome.value)
      || outcome.value.state !== 'stopped' || outcome.value.running !== false) {
      throw lifecycleError('runtime-service-untrusted', false, 'product-runtime-stop');
    }
  }

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

  stop(): Promise<void> {
    this.host ??= new ElectronFixedRuntimeLifecycleHost(loadPlatformBinding(), this.runtimeEndpoint);
    return this.host.stop();
  }

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

/** The typed reason a maintenance Runtime reports (runtime.protected-session r034). */
export const NIMI_RUNTIME_STORED_DATA_UNSUPPORTED = 'runtime-stored-data-unsupported';

class ElectronSourceRuntimeLifecycleHost implements NimiElectronRuntimeLifecycleHost {
  constructor(
    private readonly statusProbe: NimiElectronDeveloperModeStatusProbe,
    private readonly runtimeEndpoint: string,
    private readonly resolveVersion?: NimiElectronSourceRuntimeVersionResolver,
  ) {}

  async stop(): Promise<void> { throw sourceLifecycleUnavailable('product-runtime-stop'); }

  async invoke(command: string, commandNames: ElectronRuntimeBridgeCommandNames): Promise<unknown> {
    if (command === commandNames.start || command === commandNames.restart) {
      throw sourceLifecycleUnavailable(command);
    }
    if (command !== commandNames.status) {
      throw lifecycleError('runtime-service-untrusted', false, command);
    }
    try {
      await this.statusProbe.probe();
    } catch (error) {
      // A maintenance Runtime is reachable but refused its stored data: it is
      // not running and reports its exact reason instead of failing status.
      if (error instanceof NimiElectronShellHostError
        && error.reasonCode === NIMI_RUNTIME_STORED_DATA_UNSUPPORTED) {
        return {
          running: false,
          managed: false,
          launchMode: 'SOURCE',
          grpcAddr: this.runtimeEndpoint,
          lastError: NIMI_RUNTIME_STORED_DATA_UNSUPPORTED,
        };
      }
      throw error;
    }
    const version = await readSourceRuntimeVersion(this.resolveVersion);
    return {
      running: true,
      managed: false,
      launchMode: 'SOURCE',
      grpcAddr: this.runtimeEndpoint,
      ...(version ? { version } : {}),
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
        createSourceRuntimeVersionResolver(),
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
  options?: { readonly resolveVersion?: NimiElectronSourceRuntimeVersionResolver },
): NimiElectronRuntimeLifecycleHost {
  return new ElectronSourceRuntimeLifecycleHost(
    statusProbe,
    runtimeEndpoint,
    options?.resolveVersion,
  );
}

/** @internal Focused contract-test seam; not re-exported from the public main entrypoint. */
export function createNimiElectronSourceRuntimeVersionResolverForTest(
  dependencies: NimiElectronSourceRuntimeVersionProbeDependencies,
): NimiElectronSourceRuntimeVersionResolver {
  return createSourceRuntimeVersionResolver(dependencies);
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
    || typeof value.fixedRuntimeServiceRestart !== 'function'
    || typeof value.fixedRuntimeServiceStop !== 'function') {
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

function createSourceRuntimeVersionResolver(
  dependencies: NimiElectronSourceRuntimeVersionProbeDependencies = {},
): NimiElectronSourceRuntimeVersionResolver {
  let cached: { readonly key: string; readonly version: string } | undefined;
  let inFlight: { readonly key: string; readonly promise: Promise<string | undefined> } | undefined;

  return async () => {
    const verified = resolveVerifiedSourceRuntimeExecutable(dependencies);
    if (!verified) return undefined;
    if (cached?.key === verified.cacheKey) {
      return cached.version;
    }
    if (inFlight?.key === verified.cacheKey) {
      return inFlight.promise;
    }
    const exec = dependencies.execFile ?? execFileUtf8;
    const pending = (async (): Promise<string | undefined> => {
      try {
        const stdout = await exec(verified.executablePath, ['version', '--json'], {
          timeout: SOURCE_RUNTIME_VERSION_TIMEOUT_MS,
          maxBuffer: SOURCE_RUNTIME_VERSION_MAX_BUFFER_BYTES,
          windowsHide: true,
        });
        const version = parseSourceRuntimeVersionJson(stdout);
        if (version) {
          cached = { key: verified.cacheKey, version };
        }
        return version;
      } catch {
        return undefined;
      }
    })();
    inFlight = { key: verified.cacheKey, promise: pending };
    try {
      return await pending;
    } finally {
      if (inFlight?.promise === pending) {
        inFlight = undefined;
      }
    }
  };
}

function resolveVerifiedSourceRuntimeExecutable(
  dependencies: NimiElectronSourceRuntimeVersionProbeDependencies,
): { readonly executablePath: string; readonly cacheKey: string } | undefined {
  const platform = dependencies.platform ?? process.platform;
  const env = dependencies.env ?? process.env;
  const lstat = dependencies.lstat ?? lstatSync;
  const realpath = dependencies.realpath ?? realpathSync;

  try {
    if (platform === 'darwin') {
      if (env.NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT !== '1') return undefined;
      const rawExecutable = exactNonEmptyPath(env.NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE);
      if (!rawExecutable
        || !path.posix.isAbsolute(rawExecutable)
        || path.posix.normalize(rawExecutable) !== rawExecutable) {
        return undefined;
      }
      const expectedTail = `/${MACOS_SOURCE_RUNTIME_RELATIVE_TAIL.join('/')}`;
      if (!rawExecutable.endsWith(expectedTail)) return undefined;
      const metadata = lstat(rawExecutable);
      const canonical = realpath(rawExecutable);
      const uid = (dependencies.geteuid ?? process.geteuid)?.();
      if (!metadata.isFile()
        || metadata.isSymbolicLink()
        || canonical !== rawExecutable
        || uid === undefined
        || uid === 0
        || metadata.uid !== uid
        || (metadata.mode & 0o022) !== 0
        || (metadata.mode & 0o111) === 0) {
        return undefined;
      }
      return {
        executablePath: rawExecutable,
        cacheKey: `${rawExecutable}\0${metadata.ino}\0${metadata.mtimeMs}\0${metadata.size}`,
      };
    }

    if (platform === 'win32') {
      if (env.NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT !== '1') return undefined;
      const rawExecutable = exactNonEmptyPath(env.NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE);
      if (!rawExecutable || !path.win32.isAbsolute(rawExecutable)) return undefined;
      const resolved = path.win32.resolve(rawExecutable);
      const expectedTail = `\\${WINDOWS_SOURCE_RUNTIME_RELATIVE_TAIL.join('\\')}`;
      if (!resolved.toLowerCase().endsWith(expectedTail.toLowerCase())) return undefined;
      const metadata = lstat(resolved);
      const canonical = realpath(resolved);
      if (!metadata.isFile()
        || metadata.isSymbolicLink()
        || canonical.toLowerCase() !== resolved.toLowerCase()) {
        return undefined;
      }
      return {
        executablePath: resolved,
        cacheKey: `${resolved.toLowerCase()}\0${metadata.ino}\0${metadata.mtimeMs}\0${metadata.size}`,
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function readSourceRuntimeVersion(
  resolveVersion?: NimiElectronSourceRuntimeVersionResolver,
): Promise<string | undefined> {
  if (!resolveVersion) return undefined;
  try {
    return normalizeBoundedRuntimeVersion(await resolveVersion());
  } catch {
    return undefined;
  }
}

function parseSourceRuntimeVersionJson(stdout: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!isPlainRecord(parsed)) return undefined;
  return normalizeBoundedRuntimeVersion(parsed.nimi);
}

function execFileUtf8(
  file: string,
  args: readonly string[],
  options: { readonly timeout: number; readonly maxBuffer: number; readonly windowsHide: boolean },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        encoding: 'utf8',
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        windowsHide: options.windowsHide,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(String(stdout ?? ''));
      },
    );
  });
}

function exactNonEmptyPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    return undefined;
  }
  return value;
}

function normalizeBoundedRuntimeVersion(value: unknown): string | undefined {
  const normalized = normalizedText(value);
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9.+_-]+$/u.test(normalized)) {
    return undefined;
  }
  return normalized;
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

// kit/shell/renderer/bootstrap — Shared bootstrap orchestration contracts
//
// Provides typed contracts and reusable helpers for app bootstrap sequences.
// Apps retain their own bootstrap orchestration, store integration, daemon
// policy, and local data bootstrap. This module owns only the shared skeleton.

import type { RuntimeDefaults } from '../bridge/types.js';
export { installNimiShellRuntimeBridge } from './runtime-bridge.js';

export type BootstrapLogEvent = {
  level: 'debug' | 'info' | 'warn' | 'error';
  area: string;
  message: string;
  flowId?: string;
  details?: Record<string, unknown>;
};

export type BootstrapLogEventSink = (event: BootstrapLogEvent) => void;

export function safeBootstrapErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

// ---------------------------------------------------------------------------
// Renderer entry module loading
// ---------------------------------------------------------------------------

export const DEFAULT_DEV_RENDERER_ENTRY_IMPORT_RETRY_DELAYS_MS = [80, 160, 320, 640, 1_000] as const;

export type RendererEntryImportStageReporter = (
  stage: string,
  details?: Record<string, unknown>,
) => void;

export type RendererEntryModuleLoaderOptions = {
  retryDelaysMs?: readonly number[];
  reportStage?: RendererEntryImportStageReporter;
  setTimeout?: typeof globalThis.setTimeout;
};

export type RendererEntryModuleLoader = {
  load<T>(label: string, importer: () => Promise<T>): Promise<T>;
};

function delay(ms: number, setTimeoutImpl: typeof globalThis.setTimeout): Promise<void> {
  return new Promise((resolve) => {
    setTimeoutImpl(resolve, ms);
  });
}

export function isRetryableRendererEntryImportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return (
    message.includes('Importing a module script failed')
    || message.includes('Failed to fetch dynamically imported module')
    || message.includes('Load failed')
  );
}

export function describeRendererEntryFailureReason(reason: unknown): Record<string, unknown> {
  if (reason instanceof Error) {
    return {
      message: reason.message || '',
      name: reason.name || '',
      stack: reason.stack || '',
    };
  }
  if (reason && typeof reason === 'object') {
    return {
      message: String((reason as { message?: unknown }).message || ''),
      name: String((reason as { name?: unknown }).name || ''),
      raw: JSON.stringify(reason, (_key, value) => (
        typeof value === 'bigint' ? value.toString() : value
      )),
    };
  }
  return {
    message: String(reason || 'unhandled rejection'),
  };
}

export function createRendererEntryImportError(label: string, error: unknown, attempts: number): Error {
  const reason = error instanceof Error ? error.message : String(error || 'unknown import error');
  const wrapped = new Error(`${label} failed after ${attempts} attempt(s): ${reason}`);
  wrapped.name = 'RendererEntryImportError';
  wrapped.cause = error;
  return wrapped;
}

export function createRendererEntryModuleLoader(
  options: RendererEntryModuleLoaderOptions = {},
): RendererEntryModuleLoader {
  const retryDelaysMs = options.retryDelaysMs || [];
  const setTimeoutImpl = options.setTimeout || globalThis.setTimeout.bind(globalThis);

  return {
    async load<T>(label: string, importer: () => Promise<T>): Promise<T> {
      let attempts = 0;

      for (;;) {
        attempts += 1;
        try {
          return await importer();
        } catch (error) {
          const retryDelay = retryDelaysMs[attempts - 1];
          if (retryDelay === undefined || !isRetryableRendererEntryImportError(error)) {
            throw createRendererEntryImportError(label, error, attempts);
          }
          options.reportStage?.('renderer-entry-import-retry', {
            label,
            attempt: attempts,
            retryDelayMs: retryDelay,
            ...describeRendererEntryFailureReason(error),
          });
          await delay(retryDelay, setTimeoutImpl);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Bootstrap auth session contract
// ---------------------------------------------------------------------------

export type BootstrapAuthSource = 'anonymous' | 'env' | 'persisted';

export type BootstrapAuthSessionResult = {
  source: BootstrapAuthSource;
  accessToken: string;
  refreshToken: string;
};

export type BootstrapAuthSessionConfig = {
  runtimeDefaults: RuntimeDefaults;
  loadPersistedSession: () => Promise<{
    accessToken?: string;
    refreshToken?: string;
  } | null>;
  clearPersistedSession: () => Promise<void>;
};

export async function resolveBootstrapAuthSession(
  config: BootstrapAuthSessionConfig,
): Promise<BootstrapAuthSessionResult> {
  const envAccessToken = String(config.runtimeDefaults.realm.accessToken || '').trim();
  if (envAccessToken) {
    return {
      source: 'env',
      accessToken: envAccessToken,
      refreshToken: '',
    };
  }

  try {
    const persisted = await config.loadPersistedSession();
    const accessToken = String(persisted?.accessToken || '').trim();
    if (accessToken) {
      return {
        source: 'persisted',
        accessToken,
        refreshToken: String(persisted?.refreshToken || '').trim(),
      };
    }
  } catch {
    await config.clearPersistedSession().catch(() => undefined);
  }

  return {
    source: 'anonymous',
    accessToken: '',
    refreshToken: '',
  };
}

// ---------------------------------------------------------------------------
// Runtime readiness contract
// ---------------------------------------------------------------------------

export type RuntimeReadinessConfig = {
  getDaemonStatus: () => Promise<{ running: boolean; lastError?: string }>;
  startDaemon: () => Promise<{ running: boolean; lastError?: string }>;
  runtimeReady: () => Promise<void>;
  timeoutMs?: number;
};

export async function ensureRuntimeReady(
  config: RuntimeReadinessConfig,
): Promise<void> {
  const daemonStatus = await config.getDaemonStatus();
  if (!daemonStatus.running) {
    const startedDaemon = await config.startDaemon();
    if (!startedDaemon.running) {
      throw new Error(startedDaemon.lastError?.trim() || 'runtime daemon failed to start');
    }
  }
  const timeoutMs = config.timeoutMs ?? 15_000;
  const runtimeReadyTimeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`runtime ready timeout (${timeoutMs}ms)`)), timeoutMs),
  );
  await Promise.race([config.runtimeReady(), runtimeReadyTimeout]);
}

// ---------------------------------------------------------------------------
// Bootstrap step timing
// ---------------------------------------------------------------------------

export const DEFAULT_NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS = 5_000;

function createBootstrapStepTimeoutError(step: string, timeoutMs: number): Error {
  return new Error(`${step} timed out after ${timeoutMs}ms`);
}

export async function withBootstrapStepTimeout<T>(
  step: string,
  task: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(createBootstrapStepTimeoutError(step, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export function startNonCriticalBootstrapStep(input: {
  flowId: string;
  step: string;
  task: Promise<unknown>;
  logEvent: BootstrapLogEventSink;
  timeoutMs?: number;
}): void {
  void withBootstrapStepTimeout(
    input.step,
    input.task,
    input.timeoutMs ?? DEFAULT_NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS,
  ).catch((error) => {
    input.logEvent({
      level: 'warn',
      area: 'renderer-bootstrap',
      message: 'phase:bootstrap:non-critical-step-deferred',
      flowId: input.flowId,
      details: {
        step: input.step,
        error: safeBootstrapErrorMessage(error),
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Runtime daemon compatibility
// ---------------------------------------------------------------------------

export type RuntimeDaemonVersionCheckResult = {
  ok: boolean;
  daemonVersion: string | null;
  appVersion: string;
  severity: 'none' | 'warn' | 'fatal';
  message: string;
};

export type RuntimeDaemonVersionCheckOptions = {
  strictExactMatch?: boolean;
  logEvent?: BootstrapLogEventSink;
};

function parseSemver(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function isDevelopmentVersion(version: string): boolean {
  return /(?:^|[.-])dev(?:[.-]|$)/i.test(String(version || '').trim());
}

function emitVersionCheckEvent(
  logEvent: BootstrapLogEventSink | undefined,
  event: Omit<BootstrapLogEvent, 'area'>,
): void {
  logEvent?.({
    ...event,
    area: 'version-check',
  });
}

export function checkRuntimeDaemonVersion(
  daemonVersion: string | undefined,
  appVersionInput: string,
  options: RuntimeDaemonVersionCheckOptions = {},
): RuntimeDaemonVersionCheckResult {
  const appVersion = String(appVersionInput || '').trim();
  const strictExactMatch = options.strictExactMatch === true;

  if (!daemonVersion) {
    emitVersionCheckEvent(options.logEvent, {
      level: strictExactMatch ? 'error' : 'warn',
      message: strictExactMatch
        ? 'phase:version-check:daemon-version-missing-fatal'
        : 'phase:version-check:daemon-version-missing',
      details: { appVersion, strictExactMatch },
    });
    return {
      ok: !strictExactMatch,
      daemonVersion: null,
      appVersion,
      severity: strictExactMatch ? 'fatal' : 'warn',
      message: strictExactMatch
        ? `Daemon did not report version; packaged app requires exact runtime match for ${appVersion}`
        : 'Daemon did not report version; skipping version negotiation',
    };
  }

  const daemonParsed = parseSemver(daemonVersion);
  const appParsed = parseSemver(appVersion);

  if (!daemonParsed || !appParsed) {
    emitVersionCheckEvent(options.logEvent, {
      level: strictExactMatch ? 'error' : 'warn',
      message: strictExactMatch
        ? 'phase:version-check:semver-parse-failed-fatal'
        : 'phase:version-check:semver-parse-failed',
      details: { daemonVersion, appVersion, strictExactMatch },
    });
    return {
      ok: !strictExactMatch,
      daemonVersion,
      appVersion,
      severity: strictExactMatch ? 'fatal' : 'warn',
      message: strictExactMatch
        ? `Packaged app requires exact semver match (daemon=${daemonVersion}, app=${appVersion})`
        : `Cannot parse version strings (daemon=${daemonVersion}, app=${appVersion})`,
    };
  }

  if (daemonParsed.major !== appParsed.major) {
    emitVersionCheckEvent(options.logEvent, {
      level: 'error',
      message: 'phase:version-check:major-mismatch',
      details: { daemonVersion, appVersion },
    });
    return {
      ok: false,
      daemonVersion,
      appVersion,
      severity: 'fatal',
      message: `Major version mismatch: daemon=${daemonVersion}, app=${appVersion}. Bootstrap aborted.`,
    };
  }

  if (daemonParsed.minor !== appParsed.minor || daemonParsed.patch !== appParsed.patch) {
    if (!strictExactMatch && isDevelopmentVersion(daemonVersion)) {
      emitVersionCheckEvent(options.logEvent, {
        level: 'info',
        message: 'phase:version-check:dev-version-drift',
        details: { daemonVersion, appVersion, strictExactMatch },
      });
      return {
        ok: true,
        daemonVersion,
        appVersion,
        severity: 'none',
        message: `Development daemon version drift accepted: daemon=${daemonVersion}, app=${appVersion}`,
      };
    }
    emitVersionCheckEvent(options.logEvent, {
      level: strictExactMatch ? 'error' : 'warn',
      message: strictExactMatch
        ? 'phase:version-check:exact-mismatch'
        : 'phase:version-check:minor-patch-mismatch',
      details: { daemonVersion, appVersion, strictExactMatch },
    });
    return {
      ok: !strictExactMatch,
      daemonVersion,
      appVersion,
      severity: strictExactMatch ? 'fatal' : 'warn',
      message: strictExactMatch
        ? `Packaged app requires exact version match: daemon=${daemonVersion}, app=${appVersion}. Bootstrap aborted.`
        : `Version drift: daemon=${daemonVersion}, app=${appVersion}`,
    };
  }

  emitVersionCheckEvent(options.logEvent, {
    level: 'info',
    message: 'phase:version-check:ok',
    details: { daemonVersion, appVersion },
  });
  return {
    ok: true,
    daemonVersion,
    appVersion,
    severity: 'none',
    message: 'Version match',
  };
}

export function isRuntimeDaemonReachable(
  status: { running: boolean; version?: string },
  input: {
    appVersion: string;
    logEvent?: BootstrapLogEventSink;
  },
): boolean {
  if (!status.running) {
    return false;
  }
  return checkRuntimeDaemonVersion(status.version, input.appVersion, {
    logEvent: input.logEvent,
  }).ok;
}

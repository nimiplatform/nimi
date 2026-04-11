// kit/shell/renderer/bootstrap — Shared bootstrap orchestration contracts
//
// Provides typed contracts and reusable helpers for app bootstrap sequences.
// Apps retain their own bootstrap orchestration, store integration, daemon
// policy, and local data bootstrap. This module owns only the shared skeleton.

import type { RuntimeDefaults } from '../bridge/types.js';

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

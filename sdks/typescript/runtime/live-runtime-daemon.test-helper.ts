import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LocalAssetKind, LocalAssetStatus } from '../core-generated/runtime-typed-client';
import { createRuntime } from './index';

export type RuntimeDaemonRunContext = {
  readonly endpoint: string;
  readonly localModelsPath: string;
};

const DEFAULT_RUNTIME_READY_TIMEOUT_MS = 120_000;
const DEFAULT_RUNTIME_READY_POLL_INTERVAL_MS = 250;
const DEFAULT_RUNTIME_READY_CALL_TIMEOUT_MS = 1_000;
const DEFAULT_PROVIDER_HEALTH_READY_TIMEOUT_MS = 45_000;

async function allocatePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('failed to allocate port'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolvePromise(port);
      });
    });
    server.on('error', reject);
  });
}

function resolveRuntimeDir(): string {
  let cursor = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 12; depth += 1) {
    const candidate = resolve(cursor, 'runtime');
    if (existsSync(resolve(candidate, 'cmd', 'nimi'))) {
      return candidate;
    }
    const parent = resolve(cursor, '..');
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error('runtime directory not found from SDK vNext live smoke test');
}

async function waitForRuntimeReady(endpoint: string, appId: string): Promise<void> {
  const runtime = createRuntime({
    appId,
    transport: {
      type: 'node-grpc',
      endpoint,
    },
  });

  let lastError: unknown = null;
  const timeoutMs = resolveRuntimeReadyTimeoutMs();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const remainingMs = Math.max(1, deadline - Date.now());
      await runtime.local.listLocalAssets({
        statusFilter: LocalAssetStatus.UNSPECIFIED,
        kindFilter: LocalAssetKind.UNSPECIFIED,
        engineFilter: '',
        pageSize: 1,
        pageToken: '',
      }, {
        timeoutMs: Math.min(DEFAULT_RUNTIME_READY_CALL_TIMEOUT_MS, remainingMs),
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, DEFAULT_RUNTIME_READY_POLL_INTERVAL_MS));
    }
  }

  throw new Error(`runtime readiness check failed after ${timeoutMs}ms: ${String(lastError)}`);
}

function expectedCloudProviderHealthNames(runtimeEnv: Readonly<Record<string, string>> | undefined): string[] {
  if (!runtimeEnv) return [];
  const names = new Set<string>();
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (!String(value || '').trim()) continue;
    const match = key.match(/^NIMI_RUNTIME_CLOUD_(.+)_API_KEY$/);
    if (!match) continue;
    const provider = match[1]
      .trim()
      .toLowerCase()
      .replace(/_/g, '-');
    if (provider) names.add(`cloud-${provider}`);
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

async function waitForCloudProviderHealth(
  endpoint: string,
  appId: string,
  providerNames: readonly string[],
): Promise<void> {
  if (providerNames.length === 0) return;

  const runtime = createRuntime({
    appId,
    transport: {
      type: 'node-grpc',
      endpoint,
    },
  });
  const wanted = new Set(providerNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const timeoutMs = resolveProviderHealthReadyTimeoutMs();
  const deadline = Date.now() + timeoutMs;
  let lastSummary = '';

  while (Date.now() < deadline) {
    const response = await runtime.audit.listAIProviderHealth({}, {
      timeoutMs: Math.min(DEFAULT_RUNTIME_READY_CALL_TIMEOUT_MS, Math.max(1, deadline - Date.now())),
    });
    const byName = new Map<string, { readonly state?: string; readonly reason?: string }>();
    for (const provider of response.providers) {
      const providerName = String(provider.providerName || '').trim().toLowerCase();
      if (providerName) {
        byName.set(providerName, provider);
      }
      for (const subHealth of provider.subHealth || []) {
        const subProviderName = String(subHealth.providerName || '').trim().toLowerCase();
        if (subProviderName) {
          byName.set(subProviderName, subHealth);
        }
      }
    }
    const missing: string[] = [];
    const unhealthy: string[] = [];
    for (const name of wanted) {
      const item = byName.get(name);
      if (!item) {
        missing.push(name);
        continue;
      }
      if (String(item.state || '').trim().toLowerCase() !== 'healthy') {
        unhealthy.push(`${name}:${item.state || 'unknown'}:${item.reason || ''}`);
      }
    }
    if (missing.length === 0 && unhealthy.length === 0) {
      return;
    }
    lastSummary = [
      missing.length > 0 ? `missing=${missing.join(',')}` : '',
      unhealthy.length > 0 ? `unhealthy=${unhealthy.join(',')}` : '',
    ].filter(Boolean).join(' ');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, DEFAULT_RUNTIME_READY_POLL_INTERVAL_MS));
  }

  throw new Error(`cloud provider health readiness failed after ${timeoutMs}ms for ${providerNames.join(', ')}: ${lastSummary}`);
}

async function terminateDaemon(daemon: ReturnType<typeof spawn>): Promise<void> {
  const killGroup = (signal: NodeJS.Signals) => {
    if (daemon.pid === undefined) return;
    try {
      process.kill(-daemon.pid, signal);
    } catch {
      // ignore already-exited process groups
    }
    try {
      process.kill(daemon.pid, signal);
    } catch {
      // ignore already-exited process
    }
  };

  killGroup('SIGTERM');
  const settled = await Promise.race([
    once(daemon, 'exit'),
    new Promise((resolvePromise) => setTimeout(() => resolvePromise('timeout'), 8_000)),
  ]);
  if (settled === 'timeout') {
    killGroup('SIGKILL');
  }
}

export async function withRuntimeDaemon(
  input: {
    readonly appId: string;
    readonly runtimeEnv?: Readonly<Record<string, string>>;
    readonly run: (context: RuntimeDaemonRunContext) => Promise<void>;
  },
): Promise<void> {
  const runtimeDir = resolveRuntimeDir();
  const stateRoot = mkdtempSync(join(tmpdir(), 'nimi-sdk-vnext-runtime-'));
  const grpcPort = await allocatePort();
  const httpPort = await allocatePort();
  const endpoint = `127.0.0.1:${grpcPort}`;
  const localModelsPath = join(stateRoot, 'local-models');

  const daemon = spawn('go', ['run', './cmd/nimi', 'serve'], {
    cwd: runtimeDir,
    detached: true,
    env: {
      ...process.env,
      NIMI_RUNTIME_GRPC_ADDR: endpoint,
      NIMI_RUNTIME_HTTP_ADDR: `127.0.0.1:${httpPort}`,
      NIMI_RUNTIME_ENABLE_WORKERS: '0',
      NIMI_RUNTIME_LOCK_PATH: join(stateRoot, 'runtime.lock'),
      NIMI_RUNTIME_CONFIG_PATH: join(stateRoot, 'config.json'),
      NIMI_RUNTIME_MODEL_REGISTRY_PATH: join(stateRoot, 'model-registry.json'),
      NIMI_RUNTIME_LOCAL_STATE_PATH: join(stateRoot, 'local-state.json'),
      NIMI_RUNTIME_LOCAL_MODELS_PATH: localModelsPath,
      NIMI_RUNTIME_AUTH_DEVELOPER_REGISTRATION_ENABLED: '1',
      NIMI_RUNTIME_CONNECTOR_STORE_PATH: join(stateRoot, 'connector-store.json'),
      XDG_DATA_HOME: join(stateRoot, 'xdg-data'),
      XDG_CACHE_HOME: join(stateRoot, 'xdg-cache'),
      ...(input.runtimeEnv || {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  daemon.stdout.on('data', (chunk: Buffer | string) => {
    stdout += String(chunk || '');
  });

  let stderr = '';
  daemon.stderr.on('data', (chunk: Buffer | string) => {
    stderr += String(chunk || '');
  });

  const daemonError = once(daemon, 'error')
    .then(([error]) => error as Error)
    .catch(() => null);

  try {
    const readyOrError = await Promise.race([
      waitForRuntimeReady(endpoint, input.appId).then(() => null),
      daemonError,
    ]);

    if (readyOrError) {
      throw new Error(`runtime daemon failed before ready: ${readyOrError.message}`);
    }

    await waitForCloudProviderHealth(endpoint, input.appId, expectedCloudProviderHealthNames(input.runtimeEnv));
    await input.run({ endpoint, localModelsPath });
  } catch (error) {
    const detail = formatRuntimeLiveError(error);
    throw new Error(`${detail}\nstdout=${stdout}\nstderr=${stderr}`);
  } finally {
    await terminateDaemon(daemon);
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

function formatRuntimeLiveError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return String(error || '');
  }
  const record = error as {
    readonly message?: unknown;
    readonly code?: unknown;
    readonly reasonCode?: unknown;
    readonly actionHint?: unknown;
    readonly traceId?: unknown;
    readonly retryable?: unknown;
    readonly details?: unknown;
    readonly cause?: unknown;
  };
  const parts = [String(record.message || 'Runtime live smoke failed')];
  for (const [label, value] of [
    ['code', record.code],
    ['reasonCode', record.reasonCode],
    ['actionHint', record.actionHint],
    ['traceId', record.traceId],
    ['retryable', record.retryable],
  ] as const) {
    if (value !== undefined && value !== null && String(value).trim()) {
      parts.push(`${label}=${String(value)}`);
    }
  }
  if (record.details !== undefined) {
    parts.push(`details=${safeJson(record.details)}`);
  }
  if (record.cause !== undefined) {
    parts.push(`cause=${formatRuntimeLiveError(record.cause)}`);
  }
  return parts.join('\n');
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveRuntimeReadyTimeoutMs(): number {
  const configured = Number(process.env.NIMI_RUNTIME_READY_TIMEOUT_MS || '');
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_RUNTIME_READY_TIMEOUT_MS;
}

function resolveProviderHealthReadyTimeoutMs(): number {
  const configured = Number(process.env.NIMI_PROVIDER_HEALTH_READY_TIMEOUT_MS || '');
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_PROVIDER_HEALTH_READY_TIMEOUT_MS;
}

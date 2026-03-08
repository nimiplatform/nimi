import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRuntimeClient } from '../../../../src/runtime/index.js';

export type RuntimeDaemonRunContext = {
  endpoint: string;
};

const DEFAULT_RUNTIME_READY_TIMEOUT_MS = 120_000;
const DEFAULT_RUNTIME_READY_POLL_INTERVAL_MS = 250;
const DEFAULT_RUNTIME_READY_CALL_TIMEOUT_MS = 1_000;

async function allocatePort(): Promise<number> {
  return await new Promise((resolvePromise, reject) => {
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
        if (error) {
          reject(error);
          return;
        }
        resolvePromise(port);
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
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  throw new Error('runtime directory not found from sdk provider contract tests');
}

async function waitForRuntimeReady(endpoint: string, appId: string): Promise<void> {
  const client = createRuntimeClient({
    appId,
    transport: {
      type: 'node-grpc',
      endpoint,
    },
    defaults: {
      callerKind: 'desktop-core',
      callerId: 'sdk-provider-contract-ready-check',
    },
  });

  let lastError: unknown = null;
  const timeoutMs = resolveRuntimeReadyTimeoutMs();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const remainingMs = Math.max(1, deadline - Date.now());
      await client.local.listLocalModels({}, {
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

async function terminateDaemon(daemon: ReturnType<typeof spawn>): Promise<void> {
  const killGroup = (signal: NodeJS.Signals) => {
    if (daemon.pid === undefined) {
      return;
    }
    try {
      process.kill(-daemon.pid, signal);
    } catch {
      // no-op
    }
    try {
      process.kill(daemon.pid, signal);
    } catch {
      // no-op
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
    appId: string;
    runtimeEnv?: Record<string, string>;
    run: (context: RuntimeDaemonRunContext) => Promise<void>;
  },
): Promise<void> {
  const runtimeDir = resolveRuntimeDir();
  const stateRoot = mkdtempSync(join(tmpdir(), 'nimi-sdk-runtime-'));
  const grpcPort = await allocatePort();
  const httpPort = await allocatePort();
  const endpoint = `127.0.0.1:${grpcPort}`;

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

    await input.run({ endpoint });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    throw new Error(`${detail}\nstdout=${stdout}\nstderr=${stderr}`);
  } finally {
    await terminateDaemon(daemon);
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

function resolveRuntimeReadyTimeoutMs(): number {
  const configured = Number(process.env.NIMI_RUNTIME_READY_TIMEOUT_MS || '');
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_RUNTIME_READY_TIMEOUT_MS;
}

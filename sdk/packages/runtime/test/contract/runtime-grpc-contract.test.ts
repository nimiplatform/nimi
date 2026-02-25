import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

import {
  createRuntimeClient,
  templateNode,
  workflowDefinition,
  workflowEdge,
} from '../../src/index.js';

async function allocatePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
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
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

function resolveRuntimeDir(): string {
  let cursor = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth += 1) {
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
  throw new Error('runtime directory not found from sdk contract test');
}

async function waitForRuntimeReady(endpoint: string): Promise<void> {
  const client = createRuntimeClient({
    appId: 'nimi.desktop',
    transport: {
      type: 'node-grpc',
      endpoint,
    },
    defaults: {
      callerKind: 'desktop-core',
      callerId: 'sdk-runtime-contract',
    },
  });

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await client.localRuntime.listLocalModels({});
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }

  throw new Error(`runtime readiness check failed: ${String(lastError)}`);
}

async function waitForWorkflowAccepted(endpoint: string): Promise<string> {
  const client = createRuntimeClient({
    appId: 'nimi.desktop',
    transport: {
      type: 'node-grpc',
      endpoint,
    },
    defaults: {
      callerKind: 'desktop-core',
      callerId: 'sdk-runtime-contract',
    },
  });

  const source = templateNode({
    nodeId: 'source',
    config: {
      template: 'contract',
      outputMimeType: 'text/plain',
    },
  });
  const render = templateNode({
    nodeId: 'render',
    dependsOn: ['source'],
    config: {
      template: 'done: {{prompt.value}}',
      outputMimeType: 'text/plain',
    },
  });
  const definition = workflowDefinition({
    workflowType: 'sdk-runtime-contract',
    nodes: [source, render],
    edges: [workflowEdge({
      fromNodeId: 'source',
      fromOutput: 'text',
      toNodeId: 'render',
      toInput: 'prompt',
    })],
  });

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const submit = await client.workflow.submit({
        appId: 'nimi.desktop',
        subjectUserId: 'user-contract',
        definition,
        timeoutMs: 30_000,
      });
      if (!submit.accepted || !submit.taskId) {
        throw new Error('workflow not accepted');
      }
      return submit.taskId;
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }

  throw new Error(`runtime contract submit failed: ${String(lastError)}`);
}

async function terminateDaemon(daemon: ReturnType<typeof spawn>): Promise<void> {
  const killGroup = (signal: NodeJS.Signals) => {
    if (daemon.pid === undefined) return;
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

test('sdk-runtime can submit/get workflow against runtime gRPC daemon', {
  skip: process.env.NIMI_RUNTIME_CONTRACT !== '1',
  timeout: 120_000,
}, async () => {
  const runtimeDir = resolveRuntimeDir();
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
      waitForRuntimeReady(endpoint).then(() => null),
      daemonError,
    ]);
    if (readyOrError) {
      throw new Error(`runtime daemon failed before ready: ${readyOrError.message}`);
    }

    const taskId = await waitForWorkflowAccepted(endpoint);
    const client = createRuntimeClient({
      appId: 'nimi.desktop',
      transport: {
        type: 'node-grpc',
        endpoint,
      },
      defaults: {
        callerKind: 'desktop-core',
        callerId: 'sdk-runtime-contract',
      },
    });

    let status = 0;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const workflow = await client.workflow.get({ taskId });
      status = workflow.status;
      if (status === 4 || status === 5 || status === 6) {
        break;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
    }

    assert.equal(status, 4, `workflow should complete (runtimeDir=${runtimeDir}; stdout=${stdout}; stderr=${stderr})`);

    const localModels = await client.localRuntime.listLocalModels({});
    assert.ok(Array.isArray(localModels.models), 'localRuntime.listLocalModels should return array');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    throw new Error(`sdk-runtime contract failed: ${detail}\nstdout=${stdout}\nstderr=${stderr}`);
  } finally {
    await terminateDaemon(daemon);
  }
});

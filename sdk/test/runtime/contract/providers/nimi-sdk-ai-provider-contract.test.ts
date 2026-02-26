import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createNimiAiProvider } from '../../../../src/ai-provider/index.js';
import { createNimiClient } from '../../../../src/client.js';
import { createRuntimeClient } from '../../../../src/runtime/index.js';

const APP_ID = 'nimi.desktop.sdk.ai.contract';
const SUBJECT_USER_ID = 'user-sdk-contract';

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
  throw new Error('runtime directory not found from sdk ai contract test');
}

async function waitForRuntimeReady(endpoint: string): Promise<void> {
  const client = createRuntimeClient({
    appId: APP_ID,
    transport: {
      type: 'node-grpc',
      endpoint,
    },
    defaults: {
      callerKind: 'desktop-core',
      callerId: 'sdk-ai-contract-ready-check',
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

function promptFromText(text: string) {
  return [{
    role: 'user' as const,
    content: [{
      type: 'text' as const,
      text,
    }],
  }];
}

test('nimi sdk ai-provider can generate and stream text against runtime daemon', {
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

    const client = createNimiClient({
      appId: APP_ID,
      runtime: {
        transport: {
          type: 'node-grpc',
          endpoint,
        },
        defaults: {
          callerKind: 'desktop-core',
          callerId: 'sdk-ai-provider-contract',
        },
      },
    });

    assert.ok(client.runtime, 'runtime client must be configured');

    const provider = createNimiAiProvider({
      runtime: client.runtime!,
      appId: APP_ID,
      subjectUserId: SUBJECT_USER_ID,
      routePolicy: 'local-runtime',
      fallback: 'deny',
      timeoutMs: 30_000,
    });

    const textModel = provider.text('local/demo-sdk-model');

    const generated = await textModel.doGenerate({
      prompt: promptFromText('hello from sdk contract'),
      providerOptions: {},
    });

    const generatedText = generated.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('')
      .trim();

    assert.ok(generatedText.length > 0, 'generated text should not be empty');
    assert.equal(generated.finishReason.unified, 'stop');

    const streamResult = await textModel.doStream({
      prompt: promptFromText('stream from sdk contract'),
      providerOptions: {},
    });

    const reader = streamResult.stream.getReader();
    let streamText = '';
    let sawFinish = false;

    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      const part = next.value;
      if (part.type === 'text-delta') {
        streamText += part.delta;
      }
      if (part.type === 'finish') {
        sawFinish = true;
      }
    }

    assert.ok(streamText.trim().length > 0, 'streamed text should not be empty');
    assert.equal(sawFinish, true, 'stream should emit finish part');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    throw new Error(`sdk ai-provider contract failed: ${detail}\nstdout=${stdout}\nstderr=${stderr}`);
  } finally {
    await terminateDaemon(daemon);
  }
});

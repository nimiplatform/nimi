import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createNimiAiProvider } from '../../../../src/ai-provider/index.js';
import { Runtime, createRuntimeClient } from '../../../../src/runtime/index.js';

const APP_ID = 'nimi.desktop.sdk.ai.live';
const SUBJECT_USER_ID = 'user-sdk-live';

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
  throw new Error('runtime directory not found from sdk live smoke test');
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
      callerId: 'sdk-ai-live-ready-check',
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

function requiredEnvOrSkip(t: { skip: (msg?: string) => void }, key: string): string | null {
  const value = String(process.env[key] || '').trim();
  if (!value) {
    t.skip(`set ${key} to run live smoke test`);
    return null;
  }
  return value;
}

type RuntimeRunResult = {
  stdout: string;
  stderr: string;
};

async function withRuntimeDaemon(
  runtimeEnv: Record<string, string>,
  run: (endpoint: string) => Promise<void>,
): Promise<RuntimeRunResult> {
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
      ...runtimeEnv,
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

    await run(endpoint);
    return { stdout, stderr };
  } finally {
    await terminateDaemon(daemon);
  }
}

function createSdkTextModel(endpoint: string, routePolicy: 'local-runtime' | 'token-api', modelId: string) {
  const runtime = new Runtime({
    appId: APP_ID,
    transport: {
      type: 'node-grpc',
      endpoint,
    },
    defaults: {
      callerKind: 'desktop-core',
      callerId: 'sdk-ai-live-smoke',
    },
  });

  const provider = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
    routePolicy,
    fallback: 'deny',
    timeoutMs: 45_000,
  });

  return provider.text(modelId);
}

test('nimi sdk ai-provider live smoke: local provider generate text', {
  skip: process.env.NIMI_SDK_LIVE !== '1',
  timeout: 180_000,
}, async (t) => {
  const baseURL = requiredEnvOrSkip(t, 'NIMI_LIVE_LOCAL_BASE_URL');
  const modelID = requiredEnvOrSkip(t, 'NIMI_LIVE_LOCAL_MODEL_ID');
  if (!baseURL || !modelID) {
    return;
  }
  const apiKey = String(process.env.NIMI_LIVE_LOCAL_API_KEY || '').trim();

  let outputText = '';

  try {
    await withRuntimeDaemon({
      NIMI_RUNTIME_LOCAL_AI_BASE_URL: baseURL,
      ...(apiKey ? { NIMI_RUNTIME_LOCAL_AI_API_KEY: apiKey } : {}),
    }, async (endpoint) => {
      const model = createSdkTextModel(endpoint, 'local-runtime', modelID);
      const generated = await model.doGenerate({
        prompt: promptFromText('Say hello from Nimi SDK local live smoke.'),
        providerOptions: {},
      });
      outputText = generated.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('')
        .trim();
      assert.ok(outputText.length > 0, 'local live smoke output should not be empty');
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    throw new Error(`sdk local live smoke failed: ${detail}; output=${outputText}`);
  }
});

test('nimi sdk ai-provider live smoke: nimillm generate text', {
  skip: process.env.NIMI_SDK_LIVE !== '1',
  timeout: 180_000,
}, async (t) => {
  const baseURL = requiredEnvOrSkip(t, 'NIMI_LIVE_NIMILLM_BASE_URL');
  const modelID = requiredEnvOrSkip(t, 'NIMI_LIVE_NIMILLM_MODEL_ID');
  if (!baseURL || !modelID) {
    return;
  }
  const apiKey = String(process.env.NIMI_LIVE_NIMILLM_API_KEY || '').trim();

  let outputText = '';

  try {
    await withRuntimeDaemon({
      NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL: baseURL,
      ...(apiKey ? { NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY: apiKey } : {}),
    }, async (endpoint) => {
      const model = createSdkTextModel(endpoint, 'token-api', modelID);
      const generated = await model.doGenerate({
        prompt: promptFromText('Say hello from Nimi SDK NimiLLM live smoke.'),
        providerOptions: {},
      });
      outputText = generated.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('')
        .trim();
      assert.ok(outputText.length > 0, 'nimillm live smoke output should not be empty');
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    throw new Error(`sdk nimillm live smoke failed: ${detail}; output=${outputText}`);
  }
});

test('nimi sdk ai-provider live smoke: openai generate text', {
  skip: process.env.NIMI_SDK_LIVE !== '1',
  timeout: 180_000,
}, async (t) => {
  const apiKey = requiredEnvOrSkip(t, 'NIMI_LIVE_OPENAI_API_KEY');
  const modelID = requiredEnvOrSkip(t, 'NIMI_LIVE_OPENAI_MODEL_ID');
  if (!apiKey || !modelID) {
    return;
  }

  let outputText = '';

  try {
    await withRuntimeDaemon({
      NIMI_RUNTIME_CLOUD_OPENAI_BASE_URL: 'https://api.openai.com/v1',
      NIMI_RUNTIME_CLOUD_OPENAI_API_KEY: apiKey,
    }, async (endpoint) => {
      const model = createSdkTextModel(endpoint, 'token-api', modelID);
      const generated = await model.doGenerate({
        prompt: promptFromText('Say hello from Nimi SDK OpenAI live smoke.'),
        providerOptions: {},
      });
      outputText = generated.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('')
        .trim();
      assert.ok(outputText.length > 0, 'openai live smoke output should not be empty');
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    throw new Error(`sdk openai live smoke failed: ${detail}; output=${outputText}`);
  }
});

test('nimi sdk ai-provider live smoke: anthropic generate text', {
  skip: process.env.NIMI_SDK_LIVE !== '1',
  timeout: 180_000,
}, async (t) => {
  const apiKey = requiredEnvOrSkip(t, 'NIMI_LIVE_ANTHROPIC_API_KEY');
  const modelID = requiredEnvOrSkip(t, 'NIMI_LIVE_ANTHROPIC_MODEL_ID');
  if (!apiKey || !modelID) {
    return;
  }

  let outputText = '';

  try {
    await withRuntimeDaemon({
      NIMI_RUNTIME_CLOUD_ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      NIMI_RUNTIME_CLOUD_ANTHROPIC_API_KEY: apiKey,
    }, async (endpoint) => {
      const model = createSdkTextModel(endpoint, 'token-api', modelID);
      const generated = await model.doGenerate({
        prompt: promptFromText('Say hello from Nimi SDK Anthropic live smoke.'),
        providerOptions: {},
      });
      outputText = generated.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('')
        .trim();
      assert.ok(outputText.length > 0, 'anthropic live smoke output should not be empty');
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    throw new Error(`sdk anthropic live smoke failed: ${detail}; output=${outputText}`);
  }
});

test('nimi sdk ai-provider live smoke: deepseek generate text', {
  skip: process.env.NIMI_SDK_LIVE !== '1',
  timeout: 180_000,
}, async (t) => {
  const apiKey = requiredEnvOrSkip(t, 'NIMI_LIVE_DEEPSEEK_API_KEY');
  const modelID = requiredEnvOrSkip(t, 'NIMI_LIVE_DEEPSEEK_MODEL_ID');
  if (!apiKey || !modelID) {
    return;
  }

  let outputText = '';

  try {
    await withRuntimeDaemon({
      NIMI_RUNTIME_CLOUD_DEEPSEEK_BASE_URL: 'https://api.deepseek.com/v1',
      NIMI_RUNTIME_CLOUD_DEEPSEEK_API_KEY: apiKey,
    }, async (endpoint) => {
      const model = createSdkTextModel(endpoint, 'token-api', modelID);
      const generated = await model.doGenerate({
        prompt: promptFromText('Say hello from Nimi SDK DeepSeek live smoke.'),
        providerOptions: {},
      });
      outputText = generated.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('')
        .trim();
      assert.ok(outputText.length > 0, 'deepseek live smoke output should not be empty');
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    throw new Error(`sdk deepseek live smoke failed: ${detail}; output=${outputText}`);
  }
});

test('nimi sdk ai-provider live smoke: dashscope generate text', {
  skip: process.env.NIMI_SDK_LIVE !== '1',
  timeout: 180_000,
}, async (t) => {
  const apiKey = requiredEnvOrSkip(t, 'NIMI_LIVE_ALIBABA_API_KEY');
  const modelID = requiredEnvOrSkip(t, 'NIMI_LIVE_ALIBABA_CHAT_MODEL_ID');
  if (!apiKey || !modelID) {
    return;
  }

  let outputText = '';

  try {
    await withRuntimeDaemon({
      NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY: apiKey,
    }, async (endpoint) => {
      const model = createSdkTextModel(endpoint, 'token-api', modelID);
      const generated = await model.doGenerate({
        prompt: promptFromText('Say hello from Nimi SDK DashScope live smoke.'),
        providerOptions: {},
      });
      outputText = generated.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('')
        .trim();
      assert.ok(outputText.length > 0, 'dashscope live smoke output should not be empty');
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    throw new Error(`sdk dashscope live smoke failed: ${detail}; output=${outputText}`);
  }
});

test('nimi sdk ai-provider live smoke: gemini generate text', {
  skip: process.env.NIMI_SDK_LIVE !== '1',
  timeout: 180_000,
}, async (t) => {
  const apiKey = requiredEnvOrSkip(t, 'NIMI_LIVE_GEMINI_API_KEY');
  const modelID = requiredEnvOrSkip(t, 'NIMI_LIVE_GEMINI_MODEL_ID');
  if (!apiKey || !modelID) {
    return;
  }

  let outputText = '';

  try {
    await withRuntimeDaemon({
      NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      NIMI_RUNTIME_CLOUD_GEMINI_API_KEY: apiKey,
    }, async (endpoint) => {
      const model = createSdkTextModel(endpoint, 'token-api', modelID);
      const generated = await model.doGenerate({
        prompt: promptFromText('Say hello from Nimi SDK Gemini live smoke.'),
        providerOptions: {},
      });
      outputText = generated.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('')
        .trim();
      assert.ok(outputText.length > 0, 'gemini live smoke output should not be empty');
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    throw new Error(`sdk gemini live smoke failed: ${detail}; output=${outputText}`);
  }
});

test('nimi sdk ai-provider live smoke: volcengine generate text', {
  skip: process.env.NIMI_SDK_LIVE !== '1',
  timeout: 180_000,
}, async (t) => {
  const apiKey = requiredEnvOrSkip(t, 'NIMI_LIVE_VOLCENGINE_API_KEY');
  const modelID = requiredEnvOrSkip(t, 'NIMI_LIVE_VOLCENGINE_MODEL_ID');
  if (!apiKey || !modelID) {
    return;
  }

  let outputText = '';

  try {
    await withRuntimeDaemon({
      NIMI_RUNTIME_CLOUD_VOLCENGINE_BASE_URL: 'https://ark.cn-beijing.volces.com/api/v3',
      NIMI_RUNTIME_CLOUD_VOLCENGINE_API_KEY: apiKey,
    }, async (endpoint) => {
      const model = createSdkTextModel(endpoint, 'token-api', modelID);
      const generated = await model.doGenerate({
        prompt: promptFromText('Say hello from Nimi SDK Volcengine live smoke.'),
        providerOptions: {},
      });
      outputText = generated.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('')
        .trim();
      assert.ok(outputText.length > 0, 'volcengine live smoke output should not be empty');
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    throw new Error(`sdk volcengine live smoke failed: ${detail}; output=${outputText}`);
  }
});

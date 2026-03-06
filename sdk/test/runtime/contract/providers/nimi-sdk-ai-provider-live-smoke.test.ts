import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import { createNimiAiProvider } from '../../../../src/ai-provider/index.js';
import { Runtime, createRuntimeClient } from '../../../../src/runtime/index.js';
import { ExecutionMode, FallbackPolicy, RoutePolicy, ScenarioType, ScenarioJobStatus } from '../../../../src/runtime/generated/runtime/v1/ai.js';

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

type ProviderCapability =
  | 'generate'
  | 'embed'
  | 'image'
  | 'video'
  | 'tts'
  | 'stt'
  | 'voice_clone'
  | 'voice_design';

type ProviderCapabilityMatrix = Map<string, Set<ProviderCapability>>;

function canonicalCapability(value: string): ProviderCapability | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'text.generate') {
    return 'generate';
  }
  if (normalized === 'text.embed') {
    return 'embed';
  }
  if (normalized === 'image.generate') {
    return 'image';
  }
  if (normalized === 'video.generate') {
    return 'video';
  }
  if (normalized === 'audio.synthesize') {
    return 'tts';
  }
  if (normalized === 'audio.transcribe') {
    return 'stt';
  }
  return null;
}

function providerEnvToken(provider: string): string {
  return String(provider || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function loadSourceProviderCapabilityMatrix(): ProviderCapabilityMatrix {
  const runtimeDir = resolveRuntimeDir();
  const sourceDir = resolve(runtimeDir, 'catalog', 'source', 'providers');
  const matrix: ProviderCapabilityMatrix = new Map();
  const files = readdirSync(sourceDir)
    .filter((entry) => entry.endsWith('.source.yaml'))
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    const doc = YAML.parse(readFileSync(resolve(sourceDir, file), 'utf8')) || {};
    const provider = String(doc.provider || file.replace(/\.source\.yaml$/, '')).trim().toLowerCase();
    if (!provider) {
      continue;
    }
    const set = matrix.get(provider) || new Set<ProviderCapability>();
    const defaults = Array.isArray(doc?.defaults?.capabilities) ? doc.defaults.capabilities : [];
    const models = Array.isArray(doc?.models) ? doc.models : [];

    for (const model of models) {
      const capabilities = Array.isArray(model?.capabilities) && model.capabilities.length > 0
        ? model.capabilities
        : defaults;
      for (const rawCapability of capabilities) {
        const mapped = canonicalCapability(String(rawCapability || ''));
        if (mapped) {
          set.add(mapped);
        }
      }
    }

    const workflowModels = Array.isArray(doc?.voice_workflow_models) ? doc.voice_workflow_models : [];
    for (const workflowModel of workflowModels) {
      const workflowType = String(workflowModel?.workflow_type || '').trim().toLowerCase();
      if (workflowType === 'tts_v2v') {
        set.add('voice_clone');
      }
      if (workflowType === 'tts_t2v') {
        set.add('voice_design');
      }
    }

    matrix.set(provider, set);
  }

  return matrix;
}

function envValue(keys: string[]): string {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function requiredAnyEnvOrSkip(t: { skip: (msg?: string) => void }, keys: string[]): string | null {
  const value = envValue(keys);
  if (!value) {
    t.skip(`set one of ${keys.join(', ')} to run live smoke test`);
    return null;
  }
  return value;
}

function sdkRoutePolicy(provider: string): 'local-runtime' | 'token-api' {
  return provider === 'local' ? 'local-runtime' : 'token-api';
}

function runtimeRoutePolicy(provider: string): RoutePolicy {
  return provider === 'local' ? RoutePolicy.LOCAL_RUNTIME : RoutePolicy.TOKEN_API;
}

function createRuntimeModule(endpoint: string): Runtime {
  return new Runtime({
    appId: APP_ID,
    transport: {
      type: 'node-grpc',
      endpoint,
    },
    defaults: {
      callerKind: 'desktop-core',
      callerId: 'sdk-ai-live-smoke-matrix',
    },
  });
}

async function waitForScenarioJobDone(runtime: Runtime, jobId: string, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await runtime.ai.getScenarioJob({ jobId });
    const status = response.job?.status ?? ScenarioJobStatus.UNSPECIFIED;
    if (
      status === ScenarioJobStatus.COMPLETED
      || status === ScenarioJobStatus.FAILED
      || status === ScenarioJobStatus.CANCELED
      || status === ScenarioJobStatus.TIMEOUT
    ) {
      return status;
    }
    if (Date.now() > deadline) {
      throw new Error(`scenario job timeout waiting terminal status: ${jobId}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
}

function buildRuntimeEnvForProvider(t: { skip: (msg?: string) => void }, provider: string): Record<string, string> | null {
  const token = providerEnvToken(provider);
  if (provider === 'local') {
    const baseURL = requiredEnvOrSkip(t, 'NIMI_LIVE_LOCAL_BASE_URL');
    if (!baseURL) {
      return null;
    }
    const apiKey = String(process.env.NIMI_LIVE_LOCAL_API_KEY || '').trim();
    return {
      NIMI_RUNTIME_LOCAL_AI_BASE_URL: baseURL,
      ...(apiKey ? { NIMI_RUNTIME_LOCAL_AI_API_KEY: apiKey } : {}),
    };
  }

  const apiKey = requiredEnvOrSkip(t, `NIMI_LIVE_${token}_API_KEY`);
  if (!apiKey) {
    return null;
  }
  const baseURL = envValue([`NIMI_LIVE_${token}_BASE_URL`]);
  return {
    ...(baseURL ? { [`NIMI_RUNTIME_CLOUD_${token}_BASE_URL`]: baseURL } : {}),
    [`NIMI_RUNTIME_CLOUD_${token}_API_KEY`]: apiKey,
  };
}

function capabilityModelID(t: { skip: (msg?: string) => void }, provider: string, capability: ProviderCapability): string | null {
  const token = providerEnvToken(provider);
  switch (capability) {
    case 'generate':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_MODEL_ID`]);
    case 'embed':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_EMBED_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
    case 'image':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_IMAGE_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
    case 'video':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_VIDEO_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
    case 'tts':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_TTS_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
    case 'stt':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_STT_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
    case 'voice_clone':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_VOICE_CLONE_MODEL_ID`, `NIMI_LIVE_${token}_TTS_MODEL_ID`]);
    case 'voice_design':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_VOICE_DESIGN_MODEL_ID`, `NIMI_LIVE_${token}_TTS_MODEL_ID`]);
    default:
      return null;
  }
}

async function runSdkCapabilityLiveSmoke(endpoint: string, provider: string, capability: ProviderCapability, modelId: string): Promise<void> {
  const route = sdkRoutePolicy(provider);
  const runtime = createRuntimeModule(endpoint);

  if (capability === 'generate') {
    const model = createSdkTextModel(endpoint, route, modelId);
    const generated = await model.doGenerate({
      prompt: promptFromText('Nimi SDK matrix live smoke generate text'),
      providerOptions: {},
    });
    const outputText = generated.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('')
      .trim();
    assert.ok(outputText.length > 0, 'matrix generate output should not be empty');
    return;
  }

  if (capability === 'embed') {
    const output = await runtime.ai.embedding.generate({
      model: modelId,
      input: 'Nimi SDK matrix live smoke embed',
      route,
      fallback: 'deny',
      timeoutMs: 45_000,
    });
    assert.ok(output.vectors.length > 0, 'matrix embed vectors should not be empty');
    return;
  }

  if (capability === 'image') {
    const output = await runtime.media.image.generate({
      model: modelId,
      prompt: 'A minimal icon of a moon over the ocean.',
      route,
      fallback: 'deny',
      timeoutMs: 180_000,
    });
    assert.ok((output.job?.jobId || '').length > 0, 'matrix image job id should not be empty');
    return;
  }

  if (capability === 'video') {
    const output = await runtime.media.video.generate({
      model: modelId,
      mode: 't2v',
      content: [{ type: 'text', text: 'A short sunrise cinematic shot.' }],
      options: { durationSec: 1, fps: 24 },
      route,
      fallback: 'deny',
      timeoutMs: 240_000,
    });
    assert.ok((output.job?.jobId || '').length > 0, 'matrix video job id should not be empty');
    return;
  }

  if (capability === 'tts') {
    const output = await runtime.media.tts.synthesize({
      model: modelId,
      text: 'Nimi SDK matrix live smoke speech synthesis.',
      route,
      fallback: 'deny',
      timeoutMs: 180_000,
    });
    assert.ok((output.job?.jobId || '').length > 0, 'matrix tts job id should not be empty');
    return;
  }

  if (capability === 'stt') {
    const audioUri = envValue(['NIMI_LIVE_STT_AUDIO_URI']);
    if (!audioUri) {
      throw new Error('NIMI_LIVE_STT_AUDIO_URI is required for stt live smoke');
    }
    const output = await runtime.media.stt.transcribe({
      model: modelId,
      audio: { kind: 'url', url: audioUri },
      mimeType: 'audio/wav',
      route,
      fallback: 'deny',
      timeoutMs: 180_000,
    });
    assert.ok((output.job?.jobId || '').length > 0, 'matrix stt job id should not be empty');
    return;
  }

  const targetModelId = envValue([
    `NIMI_LIVE_${providerEnvToken(provider)}_${capability === 'voice_clone' ? 'VOICE_CLONE_MODEL_ID_TARGET_MODEL_ID' : 'VOICE_DESIGN_MODEL_ID_TARGET_MODEL_ID'}`,
  ]) || modelId;

  const scenarioSpec = capability === 'voice_clone'
    ? {
      oneofKind: 'voiceClone' as const,
      voiceClone: {
        targetModelId,
        input: {
          referenceAudioUri: envValue([`NIMI_LIVE_${providerEnvToken(provider)}_VOICE_REFERENCE_AUDIO_URI`, 'NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI']),
        },
      },
    }
    : {
      oneofKind: 'voiceDesign' as const,
      voiceDesign: {
        targetModelId,
        input: {
          instructionText: 'Warm and calm natural voice.',
        },
      },
    };

  if (capability === 'voice_clone' && !scenarioSpec.voiceClone.input.referenceAudioUri) {
    throw new Error('NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI is required for voice_clone live smoke');
  }

  const submit = await runtime.ai.submitScenarioJob({
    head: {
      appId: APP_ID,
      subjectUserId: SUBJECT_USER_ID,
      modelId,
      routePolicy: runtimeRoutePolicy(provider),
      fallback: FallbackPolicy.DENY,
      timeoutMs: 180_000,
      connectorId: '',
    },
    scenarioType: capability === 'voice_clone' ? ScenarioType.VOICE_CLONE : ScenarioType.VOICE_DESIGN,
    executionMode: ExecutionMode.ASYNC_JOB,
    spec: { spec: scenarioSpec },
    requestId: '',
    idempotencyKey: '',
    labels: {},
    extensions: [],
  });
  assert.ok((submit.job?.jobId || '').length > 0, 'matrix voice workflow job id should not be empty');
  const status = await waitForScenarioJobDone(runtime, submit.job?.jobId || '', 180_000);
  assert.equal(status, ScenarioJobStatus.COMPLETED, 'matrix voice workflow should complete');
}

function registerSdkProviderCapabilityMatrixTests() {
  const matrix = loadSourceProviderCapabilityMatrix();
  const orderedProviders = [...matrix.keys()].sort((left, right) => left.localeCompare(right));
  const orderedCapabilities: ProviderCapability[] = ['generate', 'embed', 'image', 'video', 'tts', 'stt', 'voice_clone', 'voice_design'];

  for (const provider of orderedProviders) {
    const capabilitySet = matrix.get(provider) || new Set<ProviderCapability>();
    for (const capability of orderedCapabilities) {
      if (!capabilitySet.has(capability)) {
        continue;
      }
      test(`nimi sdk ai-provider live smoke: ${provider} ${capability}`, {
        skip: process.env.NIMI_SDK_LIVE !== '1',
        timeout: 300_000,
      }, async (t) => {
        const runtimeEnv = buildRuntimeEnvForProvider(t, provider);
        if (!runtimeEnv) {
          return;
        }
        const modelId = capabilityModelID(t, provider, capability);
        if (!modelId) {
          return;
        }
        if (capability === 'stt' && !envValue(['NIMI_LIVE_STT_AUDIO_URI'])) {
          t.skip('set NIMI_LIVE_STT_AUDIO_URI to run stt live smoke');
          return;
        }
        if (capability === 'voice_clone' && !envValue([`NIMI_LIVE_${providerEnvToken(provider)}_VOICE_REFERENCE_AUDIO_URI`, 'NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI'])) {
          t.skip(`set NIMI_LIVE_${providerEnvToken(provider)}_VOICE_REFERENCE_AUDIO_URI or NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI`);
          return;
        }

        await withRuntimeDaemon(runtimeEnv, async (endpoint) => {
          await runSdkCapabilityLiveSmoke(endpoint, provider, capability, modelId);
        });
      });
    }
  }
}

registerSdkProviderCapabilityMatrixTests();

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import { createNimiAiProvider } from '../../../../src/ai-provider/index.js';
import { Runtime } from '../../../../src/runtime/index.js';
import { ExecutionMode, FallbackPolicy, RoutePolicy, ScenarioType, ScenarioJobStatus } from '../../../../src/runtime/generated/runtime/v1/ai.js';
import { withRuntimeDaemon } from '../helpers/runtime-daemon.js';

const APP_ID = 'nimi.desktop.sdk.ai.live';
const SUBJECT_USER_ID = 'user-sdk-live';
const LIVE_VOICE_DESIGN_INSTRUCTION = 'Warm, calm, natural narrator voice with steady pacing, clear diction, low background noise, gentle emotional range, and a polished studio delivery for long-form spoken content.';
const LIVE_VOICE_CLONE_TEXT = 'Hello from Nimi live voice clone.';

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

function fishAudioBalanceBlockMessage(provider: string, error: unknown): string {
  if (provider !== 'fish_audio') {
    return '';
  }
  const message = String((error as { message?: string } | undefined)?.message || error || '').toLowerCase();
  if (
    message.includes('insufficient balance')
    || message.includes('insufficient credits')
    || message.includes('invalid api key or insufficient balance')
  ) {
    return String((error as { message?: string } | undefined)?.message || error || '').trim();
  }
  return '';
}

function stepFunQuotaBlockMessage(provider: string, error: unknown): string {
  if (provider !== 'stepfun') {
    return '';
  }
  const normalized = error as {
    message?: string;
    reasonCode?: string;
    actionHint?: string;
    code?: string;
    cause?: {
      message?: string;
      reasonCode?: string;
      actionHint?: string;
      code?: string;
    };
  } | undefined;
  const messageParts = [
    normalized?.message,
    normalized?.reasonCode,
    normalized?.actionHint,
    normalized?.code,
    normalized?.cause?.message,
    normalized?.cause?.reasonCode,
    normalized?.cause?.actionHint,
    normalized?.cause?.code,
    error instanceof Error ? error.message : '',
  ].filter(Boolean);
  // 'stepfun' live smoke treats structured quota and rate-limit errors as skip-worthy provider blocks.
  const message = messageParts.join(' ').toLowerCase();
  if (
    message.includes('quota_exceeded')
    || message.includes('exceeded your current quota')
    || message.includes('billing details')
    || message.includes('insufficient balance')
    || message.includes('available balance')
    || message.includes('resourceexhausted')
    || message.includes('resource exhausted')
    || message.includes('ai_provider_rate_limited')
    || message.includes('replenish_provider_balance_or_skip_live_test')
  ) {
    return messageParts.join(' ').trim() || String(error || '').trim();
  }
  return '';
}

function resolveFishAudioPreflightVoiceId(): string {
  const file = resolve(resolveRuntimeDir(), 'catalog', 'source', 'providers', 'fish_audio.source.yaml');
  const doc = YAML.parse(readFileSync(file, 'utf8')) || {};
  const voiceSets = Array.isArray(doc.voice_sets) ? doc.voice_sets : [];
  for (const voiceSet of voiceSets) {
    const voices = Array.isArray(voiceSet?.voices) ? voiceSet.voices : [];
    for (const voice of voices) {
      const voiceId = String(voice?.voice_id || '').trim();
      if (voiceId) {
        return voiceId;
      }
    }
  }
  return '';
}

async function maybeSkipFishAudioBalancePreflight(
  t: { skip: (msg?: string) => void },
  provider: string,
  runtimeEnv: Record<string, string>,
  modelId: string,
): Promise<boolean> {
  if (provider !== 'fish_audio') {
    return false;
  }
  const apiKey = String(runtimeEnv.NIMI_RUNTIME_CLOUD_FISH_AUDIO_API_KEY || '').trim();
  if (!apiKey) {
    return false;
  }
  const voiceId = resolveFishAudioPreflightVoiceId();
  if (!voiceId) {
    return false;
  }
  const response = await fetch(`${String(runtimeEnv.NIMI_RUNTIME_CLOUD_FISH_AUDIO_BASE_URL || 'https://api.fish.audio').replace(/\/+$/, '')}/v1/tts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      model: String(modelId || '').trim().replace(/^cloud\//i, ''),
    },
    body: JSON.stringify({
      text: 'Nimi Fish Audio balance preflight.',
      reference_id: voiceId,
    }),
  });
  if (response.status !== 402) {
    return false;
  }
  let providerMessage = '';
  try {
    const payload = await response.json() as { message?: string };
    providerMessage = String(payload?.message || '').trim();
  } catch {
    providerMessage = '';
  }
  if (providerMessage.toLowerCase().includes('insufficient balance')) {
    t.skip(`fish_audio live smoke skipped due to provider balance block: ${providerMessage}`);
    return true;
  }
  return false;
}

function normalizeCloudModelId(modelId: string): string {
  const normalizedModelId = String(modelId || '').trim();
  if (!normalizedModelId) {
    return normalizedModelId;
  }
  const lower = normalizedModelId.toLowerCase();
  if (lower.startsWith('cloud/') || normalizedModelId.includes('/')) {
    return normalizedModelId;
  }
  return `cloud/${normalizedModelId}`;
}

function qualifyLocalSidecarMusicModel(modelId: string): string {
  const normalizedModelId = String(modelId || '').trim();
  const lower = normalizedModelId.toLowerCase();
  if (!normalizedModelId) {
    return normalizedModelId;
  }
  if (lower.startsWith('sidecar/')) {
    return normalizedModelId;
  }
  return `sidecar/${normalizedModelId}`;
}

function createSdkTextModel(
  endpoint: string,
  routePolicy: 'local' | 'cloud',
  modelId: string,
  providerId?: string,
) {
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

  const resolvedModelId = routePolicy === 'cloud'
    ? normalizeCloudModelId(modelId)
    : modelId;
  return provider.text(resolvedModelId);
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
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL: baseURL,
        ...(apiKey ? { NIMI_RUNTIME_LOCAL_LLAMA_API_KEY: apiKey } : {}),
      },
      run: async ({ endpoint }) => {
      const model = createSdkTextModel(endpoint, 'local', modelID);
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
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    throw new Error(`sdk local live smoke failed: ${detail}; output=${outputText}`);
  }
});

test('nimi sdk ai-provider live smoke: local sidecar music', {
  skip: process.env.NIMI_SDK_LIVE !== '1',
  timeout: 300_000,
}, async (t) => {
  const sidecarBaseURL = requiredEnvOrSkip(t, 'NIMI_LIVE_LOCAL_SIDECAR_BASE_URL');
  const modelID = requiredAnyEnvOrSkip(t, ['NIMI_LIVE_LOCAL_SIDECAR_MUSIC_MODEL_ID', 'NIMI_LIVE_LOCAL_MUSIC_MODEL_ID']);
  if (!sidecarBaseURL || !modelID) {
    return;
  }
  const localBaseURL = envValue(['NIMI_LIVE_LOCAL_BASE_URL']) || 'http://127.0.0.1:8000/v1';
  const localAPIKey = String(process.env.NIMI_LIVE_LOCAL_API_KEY || '').trim();
  const sidecarAPIKey = String(process.env.NIMI_LIVE_LOCAL_SIDECAR_API_KEY || '').trim();

  await withRuntimeDaemon({
    appId: APP_ID,
    runtimeEnv: {
      NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL: localBaseURL,
      ...(localAPIKey ? { NIMI_RUNTIME_LOCAL_LLAMA_API_KEY: localAPIKey } : {}),
      NIMI_RUNTIME_LOCAL_SIDECAR_BASE_URL: sidecarBaseURL,
      ...(sidecarAPIKey ? { NIMI_RUNTIME_LOCAL_SIDECAR_API_KEY: sidecarAPIKey } : {}),
    },
    run: async ({ endpoint }) => {
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
      const output = await runtime.media.music.generate({
        model: qualifyLocalSidecarMusicModel(modelID),
        prompt: 'A short atmospheric cue with warm pads and a gentle pulse.',
        title: 'Nimi SDK Local Sidecar Smoke',
        subjectUserId: SUBJECT_USER_ID,
        route: 'local',
        fallback: 'deny',
        timeoutMs: 240_000,
      });
      assert.ok((output.job?.jobId || '').length > 0, 'local sidecar music job id should not be empty');
      assert.ok(Array.isArray(output.artifacts) && output.artifacts.length > 0, 'local sidecar music should return at least one artifact');
      const first = output.artifacts[0];
      const mimeType = String(first?.mimeType || '').trim().toLowerCase();
      assert.ok(mimeType.startsWith('audio/'), `local sidecar music artifact mimeType must be audio/*, got ${mimeType}`);
      const bytesLength = first?.bytes?.length || 0;
      const uri = String(first?.uri || '').trim();
      assert.ok(bytesLength > 0 || uri.length > 0, 'local sidecar music artifact must contain bytes or uri');
    },
  });
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
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL: baseURL,
        ...(apiKey ? { NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY: apiKey } : {}),
      },
      run: async ({ endpoint }) => {
      const model = createSdkTextModel(endpoint, 'cloud', modelID, 'nimillm');
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
      },
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
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_CLOUD_OPENAI_BASE_URL: 'https://api.openai.com/v1',
        NIMI_RUNTIME_CLOUD_OPENAI_API_KEY: apiKey,
      },
      run: async ({ endpoint }) => {
      const model = createSdkTextModel(endpoint, 'cloud', modelID, 'openai');
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
      },
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
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_CLOUD_ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
        NIMI_RUNTIME_CLOUD_ANTHROPIC_API_KEY: apiKey,
      },
      run: async ({ endpoint }) => {
      const model = createSdkTextModel(endpoint, 'cloud', modelID, 'anthropic');
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
      },
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
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_CLOUD_DEEPSEEK_BASE_URL: 'https://api.deepseek.com/v1',
        NIMI_RUNTIME_CLOUD_DEEPSEEK_API_KEY: apiKey,
      },
      run: async ({ endpoint }) => {
      const model = createSdkTextModel(endpoint, 'cloud', modelID, 'deepseek');
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
      },
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
  const apiKey = requiredEnvOrSkip(t, 'NIMI_LIVE_DASHSCOPE_API_KEY');
  const modelID = requiredEnvOrSkip(t, 'NIMI_LIVE_DASHSCOPE_MODEL_ID');
  if (!apiKey || !modelID) {
    return;
  }

  let outputText = '';

  try {
    await withRuntimeDaemon({
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY: apiKey,
      },
      run: async ({ endpoint }) => {
      const model = createSdkTextModel(endpoint, 'cloud', modelID, 'dashscope');
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
      },
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
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        NIMI_RUNTIME_CLOUD_GEMINI_API_KEY: apiKey,
      },
      run: async ({ endpoint }) => {
      const model = createSdkTextModel(endpoint, 'cloud', modelID, 'gemini');
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
      },
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
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_CLOUD_VOLCENGINE_BASE_URL: 'https://ark.cn-beijing.volces.com/api/v3',
        NIMI_RUNTIME_CLOUD_VOLCENGINE_API_KEY: apiKey,
      },
      run: async ({ endpoint }) => {
      const model = createSdkTextModel(endpoint, 'cloud', modelID, 'volcengine');
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
      },
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
  | 'music'
  | 'voice_clone'
  | 'voice_design';

type ProviderCapabilityMatrix = Map<string, Set<ProviderCapability>>;

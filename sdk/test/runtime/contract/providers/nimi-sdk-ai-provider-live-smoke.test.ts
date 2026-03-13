import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
  if (lower.startsWith('sidecar/') || lower.startsWith('localsidecar/')) {
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
        NIMI_RUNTIME_LOCAL_AI_BASE_URL: baseURL,
        ...(apiKey ? { NIMI_RUNTIME_LOCAL_AI_API_KEY: apiKey } : {}),
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
      NIMI_RUNTIME_LOCAL_AI_BASE_URL: localBaseURL,
      ...(localAPIKey ? { NIMI_RUNTIME_LOCAL_AI_API_KEY: localAPIKey } : {}),
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
  if (normalized === 'music.generate' || normalized === 'music.generate.iteration') {
    return 'music';
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

function resolveLiveAudioMime(resource: string): string {
  const normalized = String(resource || '').trim().toLowerCase();
  if (normalized.endsWith('.mp3')) {
    return 'audio/mpeg';
  }
  if (normalized.endsWith('.m4a')) {
    return 'audio/mp4';
  }
  if (normalized.endsWith('.ogg')) {
    return 'audio/ogg';
  }
  return 'audio/wav';
}

function loadLiveAudioBytes(filePath: string): Uint8Array {
  const bytes = readFileSync(filePath);
  assert.ok(bytes.length > 0, `${filePath} should not be empty`);
  return new Uint8Array(bytes);
}

function resolveLiveSttAudioInput():
  | { audio: { kind: 'bytes'; bytes: Uint8Array }; mimeType: string }
  | { audio: { kind: 'url'; url: string }; mimeType: string }
  | null {
  const audioPath = envValue(['NIMI_LIVE_STT_AUDIO_PATH']);
  if (audioPath) {
    return {
      audio: { kind: 'bytes', bytes: loadLiveAudioBytes(audioPath) },
      mimeType: resolveLiveAudioMime(audioPath),
    };
  }

  const audioUri = envValue(['NIMI_LIVE_STT_AUDIO_URI']);
  if (!audioUri) {
    return null;
  }
  return {
    audio: { kind: 'url', url: audioUri },
    mimeType: resolveLiveAudioMime(audioUri),
  };
}

function resolveLiveVoiceCloneAudioInput(provider: string):
  | { referenceAudioBytes: Uint8Array; referenceAudioMime: string }
  | { referenceAudioUri: string; referenceAudioMime: string }
  | null {
  const token = providerEnvToken(provider);
  const audioPath = envValue([
    `NIMI_LIVE_${token}_VOICE_REFERENCE_AUDIO_PATH`,
    'NIMI_LIVE_VOICE_REFERENCE_AUDIO_PATH',
  ]);
  if (audioPath) {
    return {
      referenceAudioBytes: loadLiveAudioBytes(audioPath),
      referenceAudioMime: resolveLiveAudioMime(audioPath),
    };
  }

  const audioUri = envValue([
    `NIMI_LIVE_${token}_VOICE_REFERENCE_AUDIO_URI`,
    'NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI',
  ]);
  if (!audioUri) {
    return null;
  }
  return {
    referenceAudioUri: audioUri,
    referenceAudioMime: resolveLiveAudioMime(audioUri),
  };
}

function resolveLiveVoiceCloneText(provider: string): string {
  const token = providerEnvToken(provider);
  const value = envValue([
    `NIMI_LIVE_${token}_VOICE_CLONE_TEXT`,
    'NIMI_LIVE_VOICE_CLONE_TEXT',
  ]);
  if (value) {
    return value;
  }
  if (provider === 'stepfun') {
    return LIVE_VOICE_CLONE_TEXT;
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

function sdkRoutePolicy(provider: string): 'local' | 'cloud' {
  return provider === 'local' ? 'local' : 'cloud';
}

function runtimeRoutePolicy(provider: string): RoutePolicy {
  return provider === 'local' ? RoutePolicy.LOCAL : RoutePolicy.CLOUD;
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

async function waitForScenarioJobDone(runtime: Runtime, jobId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await runtime.ai.getScenarioJob({ jobId });
    const job = response.job;
    const status = job?.status ?? ScenarioJobStatus.UNSPECIFIED;
    if (
      status === ScenarioJobStatus.COMPLETED
      || status === ScenarioJobStatus.FAILED
      || status === ScenarioJobStatus.CANCELED
      || status === ScenarioJobStatus.TIMEOUT
    ) {
      return job;
    }
    if (Date.now() > deadline) {
      throw new Error(`scenario job timeout waiting terminal status: ${jobId}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
}

async function deleteVoiceAssetIfPresent(runtime: Runtime, voiceAssetId: string | undefined): Promise<void> {
  const normalized = String(voiceAssetId || '').trim();
  if (!normalized) {
    return;
  }
  const response = await runtime.ai.deleteVoiceAsset({ voiceAssetId: normalized });
  assert.equal(response.ack?.ok, true, `deleteVoiceAsset should acknowledge cleanup for ${normalized}`);
}

async function resolveSdkLiveTTSVoice(runtime: Runtime, provider: string, modelId: string): Promise<string | undefined> {
  const response = await runtime.media.tts.listVoices({
    model: String(modelId || '').trim(),
    route: sdkRoutePolicy(provider),
    subjectUserId: SUBJECT_USER_ID,
  });
  const firstVoice = response.voices[0];
  const voiceId = String(
    provider === 'dashscope'
      ? (firstVoice?.name || firstVoice?.voiceId || '')
      : (firstVoice?.voiceId || ''),
  ).trim();
  return voiceId || undefined;
}

function buildRuntimeEnvForProvider(t: { skip: (msg?: string) => void }, provider: string): Record<string, string> | null {
  const token = providerEnvToken(provider);
  if (provider === 'local') {
    const baseURL = requiredEnvOrSkip(t, 'NIMI_LIVE_LOCAL_BASE_URL');
    if (!baseURL) {
      return null;
    }
    const apiKey = String(process.env.NIMI_LIVE_LOCAL_API_KEY || '').trim();
    const sidecarBaseURL = String(process.env.NIMI_LIVE_LOCAL_SIDECAR_BASE_URL || '').trim();
    const sidecarAPIKey = String(process.env.NIMI_LIVE_LOCAL_SIDECAR_API_KEY || '').trim();
    return {
      NIMI_RUNTIME_LOCAL_AI_BASE_URL: baseURL,
      ...(apiKey ? { NIMI_RUNTIME_LOCAL_AI_API_KEY: apiKey } : {}),
      ...(sidecarBaseURL ? { NIMI_RUNTIME_LOCAL_SIDECAR_BASE_URL: sidecarBaseURL } : {}),
      ...(sidecarAPIKey ? { NIMI_RUNTIME_LOCAL_SIDECAR_API_KEY: sidecarAPIKey } : {}),
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
    ...(provider === 'mubert' && envValue(['NIMI_LIVE_MUBERT_CUSTOMER_ID'])
      ? { NIMI_RUNTIME_CLOUD_MUBERT_CUSTOMER_ID: envValue(['NIMI_LIVE_MUBERT_CUSTOMER_ID']) }
      : {}),
    ...(provider === 'mubert' && envValue(['NIMI_LIVE_MUBERT_ACCESS_TOKEN'])
      ? { NIMI_RUNTIME_CLOUD_MUBERT_ACCESS_TOKEN: envValue(['NIMI_LIVE_MUBERT_ACCESS_TOKEN']) }
      : {}),
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
    case 'music':
      return requiredAnyEnvOrSkip(t, [`NIMI_LIVE_${token}_MUSIC_MODEL_ID`, `NIMI_LIVE_${token}_MODEL_ID`]);
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
  const routedModelId = route === 'cloud'
    ? normalizeCloudModelId(modelId)
    : modelId;

  if (capability === 'generate') {
    const model = createSdkTextModel(endpoint, route, modelId, provider);
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
      model: routedModelId,
      input: 'Nimi SDK matrix live smoke embed',
      subjectUserId: SUBJECT_USER_ID,
      route,
      fallback: 'deny',
      timeoutMs: 45_000,
    });
    assert.ok(output.vectors.length > 0, 'matrix embed vectors should not be empty');
    return;
  }

  if (capability === 'image') {
    const output = await runtime.media.image.generate({
      model: routedModelId,
      prompt: 'A minimal icon of a moon over the ocean.',
      subjectUserId: SUBJECT_USER_ID,
      route,
      fallback: 'deny',
      timeoutMs: 180_000,
    });
    assert.ok((output.job?.jobId || '').length > 0, 'matrix image job id should not be empty');
    return;
  }

  if (capability === 'video') {
    const output = await runtime.media.video.generate({
      model: routedModelId,
      mode: 't2v',
      content: [{ type: 'text', text: 'A short sunrise cinematic shot.' }],
      options: { durationSec: 1, fps: 24 },
      subjectUserId: SUBJECT_USER_ID,
      route,
      fallback: 'deny',
      timeoutMs: 240_000,
    });
    assert.ok((output.job?.jobId || '').length > 0, 'matrix video job id should not be empty');
    return;
  }

  if (capability === 'tts') {
    const voice = await resolveSdkLiveTTSVoice(runtime, provider, routedModelId);
    const output = await runtime.media.tts.synthesize({
      model: routedModelId,
      text: 'Nimi SDK matrix live smoke speech synthesis.',
      voice,
      subjectUserId: SUBJECT_USER_ID,
      route,
      fallback: 'deny',
      timeoutMs: 180_000,
    });
    assert.ok((output.job?.jobId || '').length > 0, 'matrix tts job id should not be empty');
    return;
  }

  if (capability === 'stt') {
    const audioInput = resolveLiveSttAudioInput();
    if (!audioInput) {
      throw new Error('NIMI_LIVE_STT_AUDIO_PATH or NIMI_LIVE_STT_AUDIO_URI is required for stt live smoke');
    }
    const output = await runtime.media.stt.transcribe({
      model: routedModelId,
      audio: audioInput.audio,
      mimeType: audioInput.mimeType,
      subjectUserId: SUBJECT_USER_ID,
      route,
      fallback: 'deny',
      timeoutMs: 180_000,
    });
    assert.ok((output.job?.jobId || '').length > 0, 'matrix stt job id should not be empty');
    return;
  }

  if (capability === 'music') {
    const output = await runtime.media.music.generate({
      model: routedModelId,
      prompt: 'A short atmospheric cue for a product intro with warm synths and a gentle pulse.',
      title: 'Nimi SDK Music Smoke',
      subjectUserId: SUBJECT_USER_ID,
      route,
      fallback: 'deny',
      timeoutMs: 240_000,
    });
    assert.ok((output.job?.jobId || '').length > 0, 'matrix music job id should not be empty');
    return;
  }

  const targetModelId = envValue([
    `NIMI_LIVE_${providerEnvToken(provider)}_${capability === 'voice_clone' ? 'VOICE_CLONE_MODEL_ID_TARGET_MODEL_ID' : 'VOICE_DESIGN_MODEL_ID_TARGET_MODEL_ID'}`,
  ]) || modelId;
  const voiceCloneAudioInput = capability === 'voice_clone'
    ? resolveLiveVoiceCloneAudioInput(provider)
    : null;
  const voiceCloneText = capability === 'voice_clone'
    ? resolveLiveVoiceCloneText(provider)
    : '';

  const scenarioSpec = capability === 'voice_clone'
    ? {
      oneofKind: 'voiceClone' as const,
      voiceClone: {
        targetModelId,
        input: {
          ...(voiceCloneAudioInput || {}),
          ...(voiceCloneText ? { text: voiceCloneText } : {}),
        },
      },
    }
    : {
      oneofKind: 'voiceDesign' as const,
      voiceDesign: {
        targetModelId,
        input: {
          instructionText: LIVE_VOICE_DESIGN_INSTRUCTION,
        },
      },
    };

  if (capability === 'voice_clone' && !voiceCloneAudioInput) {
    throw new Error('voice clone live smoke requires reference audio path or URI');
  }

  const submit = await runtime.ai.submitScenarioJob({
    head: {
      appId: APP_ID,
      subjectUserId: SUBJECT_USER_ID,
      modelId: routedModelId,
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
  const voiceAssetId = String(submit.asset?.voiceAssetId || '').trim() || undefined;
  let cleanupError: unknown = null;
  try {
    const job = await waitForScenarioJobDone(runtime, submit.job?.jobId || '', 180_000);
    assert.equal(
      job?.status,
      ScenarioJobStatus.COMPLETED,
      `matrix voice workflow should complete: status=${job?.status} reasonCode=${job?.reasonCode} detail=${job?.reasonDetail || ''}`,
    );
  } finally {
    try {
      await deleteVoiceAssetIfPresent(runtime, voiceAssetId);
    } catch (error) {
      cleanupError = error;
    }
  }
  if (cleanupError) {
    throw cleanupError;
  }
}

function registerSdkProviderCapabilityMatrixTests() {
  const matrix = loadSourceProviderCapabilityMatrix();
  const orderedProviders = [...matrix.keys()].sort((left, right) => left.localeCompare(right));
  const orderedCapabilities: ProviderCapability[] = ['generate', 'embed', 'image', 'video', 'tts', 'stt', 'music', 'voice_clone', 'voice_design'];

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
        if (
          capability === 'stt'
          && !envValue(['NIMI_LIVE_STT_AUDIO_PATH', 'NIMI_LIVE_STT_AUDIO_URI'])
        ) {
          t.skip('set NIMI_LIVE_STT_AUDIO_PATH or NIMI_LIVE_STT_AUDIO_URI to run stt live smoke');
          return;
        }
        if (
          capability === 'voice_clone'
          && !envValue([
            `NIMI_LIVE_${providerEnvToken(provider)}_VOICE_REFERENCE_AUDIO_PATH`,
            'NIMI_LIVE_VOICE_REFERENCE_AUDIO_PATH',
            `NIMI_LIVE_${providerEnvToken(provider)}_VOICE_REFERENCE_AUDIO_URI`,
            'NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI',
          ])
        ) {
          t.skip(`set NIMI_LIVE_${providerEnvToken(provider)}_VOICE_REFERENCE_AUDIO_PATH or NIMI_LIVE_${providerEnvToken(provider)}_VOICE_REFERENCE_AUDIO_URI`);
          return;
        }
        if (await maybeSkipFishAudioBalancePreflight(t, provider, runtimeEnv, modelId)) {
          return;
        }

        await withRuntimeDaemon({
          appId: APP_ID,
          runtimeEnv,
          run: async ({ endpoint }) => {
            try {
              await runSdkCapabilityLiveSmoke(endpoint, provider, capability, modelId);
            } catch (error) {
              const skipMessage = fishAudioBalanceBlockMessage(provider, error);
              if (skipMessage) {
                t.skip(`fish_audio live smoke skipped due to provider balance block: ${skipMessage}`);
                return;
              }
              const stepFunSkipMessage = stepFunQuotaBlockMessage(provider, error);
              if (stepFunSkipMessage) {
                t.skip(`stepfun live smoke skipped due to provider quota block: ${stepFunSkipMessage}`);
                return;
              }
              throw error;
            }
          },
        });
      });
    }
  }
}

registerSdkProviderCapabilityMatrixTests();

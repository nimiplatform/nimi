// RL-IPC-006 — Input transform: IPC input shape → SDK TextGenerateInput / TextStreamInput
// Replicates sdk/src/runtime/runtime-convenience.ts resolution logic for relay IPC layer.

import type {
  TextGenerateInput,
  TextStreamInput,
  TextMessage,
  NimiRoutePolicy,
} from '@nimiplatform/sdk/runtime';

export type IpcAiGenerateInput = {
  prompt: string | TextMessage[];
  model?: string;
  provider?: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  subjectUserId?: string;
  fallback?: 'deny' | 'allow';
  timeoutMs?: number;
  metadata?: Record<string, string>;
  agentId?: string;
};

export type IpcAiStreamInput = IpcAiGenerateInput;

const DEFAULT_SUBJECT_USER_ID = 'local-user';

// Mirror of sdk/src/runtime/provider-targeting.generated.ts
const REMOTE_PROVIDER_SET = new Set([
  'anthropic', 'aws_polly', 'azure', 'azure_speech', 'bedrock', 'cohere',
  'dashscope', 'deepseek', 'elevenlabs', 'fireworks', 'fish_audio', 'flux',
  'gemini', 'glm', 'google_cloud_tts', 'google_veo', 'groq', 'hunyuan',
  'ideogram', 'kimi', 'kling', 'luma', 'minimax', 'mistral', 'nimillm',
  'openai', 'openai_compatible', 'openrouter', 'perplexity', 'pika',
  'qianfan', 'runway', 'siliconflow', 'spark', 'stability', 'stepfun',
  'suno', 'together', 'volcengine', 'volcengine_openspeech', 'xai',
]);

function normalize(value: string | undefined): string {
  return String(value || '').trim();
}

function isLowercaseQualifiedPrefix(prefix: string): boolean {
  return prefix === prefix.toLowerCase() && /^[a-z0-9_][a-z0-9_-]*$/u.test(prefix);
}

function looksLikeQualifiedRemoteModel(model: string): boolean {
  const normalized = normalize(model);
  if (!normalized.includes('/')) {
    return false;
  }
  const [prefix = ''] = normalized.split('/', 1);
  const lowered = prefix.toLowerCase();
  if (lowered === 'cloud' || lowered === 'local' || lowered === 'localai' || lowered === 'nexa') {
    return true;
  }
  return isLowercaseQualifiedPrefix(prefix) && REMOTE_PROVIDER_SET.has(lowered);
}

export function resolveModelAndRoute(
  provider: string | undefined,
  model: string | undefined,
): { model: string; route: NimiRoutePolicy } {
  const p = normalize(provider);
  const m = normalize(model);

  if (!p && !m) {
    return { model: 'local/default', route: 'local' };
  }

  if (!p) {
    if (looksLikeQualifiedRemoteModel(m)) {
      throw new Error(
        'IPC relay does not accept fully-qualified remote model ids without a provider. Use provider + model, or call runtime.ai.text.generate() directly.',
      );
    }
    return { model: `local/${m}`, route: 'local' };
  }

  if (!REMOTE_PROVIDER_SET.has(p.toLowerCase())) {
    throw new Error(
      `unsupported provider "${p}". Use a canonical provider id such as gemini, openai, anthropic, or deepseek.`,
    );
  }

  if (m && looksLikeQualifiedRemoteModel(m)) {
    throw new Error(
      'provider + model expects a provider-scoped model id. Remove the remote prefix.',
    );
  }

  return { model: `${p}/${m || 'default'}`, route: 'cloud' };
}

export function toTextGenerateInput(input: IpcAiGenerateInput): TextGenerateInput {
  const target = resolveModelAndRoute(input.provider, input.model);
  return {
    model: target.model,
    input: input.prompt,
    system: input.system,
    maxTokens: input.maxTokens,
    temperature: input.temperature,
    topP: input.topP,
    subjectUserId: normalize(input.subjectUserId) || DEFAULT_SUBJECT_USER_ID,
    route: target.route,
    fallback: input.fallback,
    timeoutMs: input.timeoutMs,
    metadata: input.metadata,
  };
}

export function toTextStreamInput(input: IpcAiStreamInput): TextStreamInput {
  return toTextGenerateInput(input);
}

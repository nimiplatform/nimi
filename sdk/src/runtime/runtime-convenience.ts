import type { NimiError } from '../types/index.js';
import type { AiRoutePolicy } from '../types/index.js';
import type { RuntimeMetadata } from './types.js';
import type {
  NimiFinishReason,
  TextGenerateInput,
  TextGenerateOutput,
  TextMessage,
  TextStreamInput,
  TextStreamPart,
  TextStreamOutput,
} from './types-media.js';
import { REMOTE_PROVIDER_IDS } from './provider-targeting.generated.js';

export type RuntimePrompt = string | TextMessage[];

export type RuntimeGenerateInput = {
  model?: string;
  provider?: string;
  prompt: RuntimePrompt;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  subjectUserId?: string;
  timeoutMs?: number;
  metadata?: RuntimeMetadata;
};

export type RuntimeGenerateResult = {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  finishReason: NimiFinishReason | string;
  traceId: string;
  modelResolved: string;
  routeDecision: AiRoutePolicy;
};

export type RuntimeStreamInput = RuntimeGenerateInput & {
  signal?: AbortSignal;
};

export type RuntimeStreamChunk =
  | { type: 'text'; text: string }
  | {
    type: 'done';
    usage: {
      inputTokens: number;
      outputTokens: number;
    };
    finishReason: NimiFinishReason | string;
    traceId: string;
    modelResolved: string;
    routeDecision: AiRoutePolicy;
  }
  | { type: 'error'; error: NimiError };

type RuntimeTextGenerateDelegate = {
  ai: {
    text: {
      generate(input: TextGenerateInput): Promise<TextGenerateOutput>;
      stream(input: TextStreamInput): Promise<TextStreamOutput>;
    };
  };
};

const DEFAULT_RUNTIME_CONVENIENCE_SUBJECT_USER_ID = 'local-user';
const REMOTE_PROVIDER_SET = new Set<string>(REMOTE_PROVIDER_IDS);

type ResolvedRuntimeTarget = {
  model: string;
  route: AiRoutePolicy;
};

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
  if (
    lowered === 'localai'
    || lowered === 'nexa'
    || lowered === 'nimi_media'
    || lowered === 'media.diffusers'
    || lowered === 'localsidecar'
  ) {
    throw new Error(
      `legacy local model prefix "${prefix}" is no longer supported. Use local/, llama/, media/, speech/, or sidecar/.`,
    );
  }
  if (
    lowered === 'cloud'
    || lowered === 'local'
    || lowered === 'llama'
    || lowered === 'media'
    || lowered === 'speech'
    || lowered === 'sidecar'
  ) {
    return true;
  }
  return isLowercaseQualifiedPrefix(prefix) && REMOTE_PROVIDER_SET.has(lowered);
}

function resolveRuntimeConvenienceTarget(input: RuntimeGenerateInput): ResolvedRuntimeTarget {
  const provider = normalize(input.provider);
  const model = normalize(input.model);

  if (!provider && !model) {
    throw new Error(
      'high-level Runtime.generate()/stream() requires an explicit local model or provider + model.',
    );
  }

  if (!provider) {
    if (looksLikeQualifiedRemoteModel(model)) {
      throw new Error(
        'high-level Runtime.generate()/stream() does not accept fully-qualified remote model ids. Use provider + model, or use runtime.ai.text.generate() for explicit remote model ids.',
      );
    }
    return {
      model: `local/${model}`,
      route: 'local',
    };
  }

  if (!REMOTE_PROVIDER_SET.has(provider.toLowerCase())) {
    throw new Error(
      `unsupported provider "${provider}". Use a canonical provider id such as gemini, openai, anthropic, or deepseek.`,
    );
  }

  if (!model) {
    throw new Error(
      'high-level Runtime.generate()/stream() requires provider + model for cloud routing. It no longer invents an implicit provider/default target.',
    );
  }

  if (model && looksLikeQualifiedRemoteModel(model)) {
    throw new Error(
      'provider + model expects a provider-scoped model id. Remove the remote prefix, or use runtime.ai.text.generate() for explicit fully-qualified remote model ids.',
    );
  }

  return {
    model: `${provider}/${model}`,
    route: 'cloud',
  };
}

function toGenerateInput(input: RuntimeGenerateInput): TextGenerateInput {
  const subjectUserId = normalize(input.subjectUserId) || DEFAULT_RUNTIME_CONVENIENCE_SUBJECT_USER_ID;
  const target = resolveRuntimeConvenienceTarget(input);
  return {
    model: target.model,
    input: input.prompt,
    system: input.system,
    maxTokens: input.maxTokens,
    temperature: input.temperature,
    topP: input.topP,
    subjectUserId,
    route: target.route,
    timeoutMs: input.timeoutMs,
    metadata: input.metadata as TextGenerateInput['metadata'],
  };
}

function toStreamInput(input: RuntimeStreamInput): TextStreamInput {
  return {
    ...toGenerateInput(input),
    signal: input.signal,
  };
}

function toUsage(input?: { inputTokens?: number; outputTokens?: number }): {
  inputTokens: number;
  outputTokens: number;
} {
  return {
    inputTokens: Number(input?.inputTokens || 0),
    outputTokens: Number(input?.outputTokens || 0),
  };
}

export function toRuntimeGenerateResult(output: TextGenerateOutput): RuntimeGenerateResult {
  return {
    text: output.text,
    usage: toUsage(output.usage),
    finishReason: output.finishReason,
    traceId: String(output.trace.traceId || ''),
    modelResolved: String(output.trace.modelResolved || ''),
    routeDecision: output.trace.routeDecision || 'local',
  };
}

export async function runtimeGenerateConvenience(
  runtime: RuntimeTextGenerateDelegate,
  input: RuntimeGenerateInput,
): Promise<RuntimeGenerateResult> {
  const output = await runtime.ai.text.generate(toGenerateInput(input));
  return toRuntimeGenerateResult(output);
}

function mapStreamPart(part: TextStreamPart): RuntimeStreamChunk | null {
  if (part.type === 'delta') {
    return {
      type: 'text',
      text: part.text,
    };
  }
  if (part.type === 'finish') {
    return {
      type: 'done',
      usage: toUsage(part.usage),
      finishReason: part.finishReason,
      traceId: String(part.trace.traceId || ''),
      modelResolved: String(part.trace.modelResolved || ''),
      routeDecision: part.trace.routeDecision || 'local',
    };
  }
  if (part.type === 'error') {
    return {
      type: 'error',
      error: part.error,
    };
  }
  return null;
}

export async function runtimeStreamConvenience(
  runtime: RuntimeTextGenerateDelegate,
  input: RuntimeStreamInput,
): Promise<AsyncIterable<RuntimeStreamChunk>> {
  const output = await runtime.ai.text.stream(toStreamInput(input));
  return {
    async *[Symbol.asyncIterator]() {
      for await (const part of output.stream) {
        const chunk = mapStreamPart(part);
        if (chunk) {
          yield chunk;
        }
      }
    },
  };
}

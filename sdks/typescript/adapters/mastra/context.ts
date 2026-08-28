import type { AgentExecutionOptionsBase } from '@mastra/core/agent';
import type {
  NimiAiContextMaterial,
  NimiAiContextProvider,
  NimiAiRunnerSpec,
  NimiAiModel,
  NimiJsonObject,
  NimiJsonValue,
  NimiMessage,
  NimiMessagePart,
} from '@nimiplatform/sdk';
import { textPart } from '@nimiplatform/sdk';

type MastraContextMessage = NonNullable<AgentExecutionOptionsBase<unknown>['context']>[number];

export interface NimiMastraContextBridgeOptions {
  readonly runner: NimiAiRunnerSpec;
  readonly model: NimiAiModel;
  readonly contextProviders: readonly NimiAiContextProvider[];
  readonly role?: 'system' | 'user';
  readonly title?: string;
}

export interface NimiMastraContextBridgeInput {
  readonly messages?: unknown;
  readonly query?: string;
}

export interface NimiMastraContextBridge {
  buildContext(input?: NimiMastraContextBridgeInput): Promise<MastraContextMessage[]>;
}

export type NimiMastraExecutionOptions<OUTPUT = unknown> = AgentExecutionOptionsBase<OUTPUT> & {
  readonly contextBridge: NimiMastraContextBridge;
  readonly query?: string;
};

export interface NimiMastraGenerateTarget<TMessages, TResult, OUTPUT = unknown> {
  generate(messages: TMessages, options?: AgentExecutionOptionsBase<OUTPUT>): Promise<TResult>;
}

export interface NimiMastraStreamTarget<TMessages, TResult, OUTPUT = unknown> {
  stream(messages: TMessages, options?: AgentExecutionOptionsBase<OUTPUT>): Promise<TResult>;
}

/**
 * Builds Mastra `context` messages from Nimi AI context providers. Providers
 * remain Nimi-owned; Mastra only receives a text projection through its public
 * per-call context API and does not own or persist memory/knowledge state.
 */
export function createNimiMastraContextBridge(options: NimiMastraContextBridgeOptions): NimiMastraContextBridge {
  const providers = [...options.contextProviders];
  const role = options.role ?? 'system';
  const title = normalizeText(options.title) || 'Nimi Runtime Context';

  return {
    async buildContext(input = {}) {
      if (providers.length === 0) {
        return [];
      }
      const providerMessages = toProviderMessages(input);
      const providerInput = {
        runner: options.runner,
        model: options.model,
        messages: providerMessages,
      };
      const sections: string[] = [];
      for (const provider of providers) {
        const material = await provider.load(providerInput);
        const text = materialToText(material);
        if (text) {
          sections.push(`[${provider.id}]\n${text}`);
        }
      }
      if (sections.length === 0) {
        return [];
      }
      return [{
        role,
        content: [`[${title}]`, ...sections].join('\n\n'),
      }];
    },
  };
}

export async function generateWithNimiMastraContext<TMessages, TResult, OUTPUT = unknown>(
  agent: NimiMastraGenerateTarget<TMessages, TResult, OUTPUT>,
  messages: TMessages,
  options: NimiMastraExecutionOptions<OUTPUT>,
): Promise<TResult> {
  const { contextBridge, query, context, ...agentOptions } = options;
  const runtimeContext = await contextBridge.buildContext({ messages, query });
  return agent.generate(messages, {
    ...agentOptions,
    context: mergeMastraContext(context, runtimeContext),
  });
}

export async function streamWithNimiMastraContext<TMessages, TResult, OUTPUT = unknown>(
  agent: NimiMastraStreamTarget<TMessages, TResult, OUTPUT>,
  messages: TMessages,
  options: NimiMastraExecutionOptions<OUTPUT>,
): Promise<TResult> {
  const { contextBridge, query, context, ...agentOptions } = options;
  const runtimeContext = await contextBridge.buildContext({ messages, query });
  return agent.stream(messages, {
    ...agentOptions,
    context: mergeMastraContext(context, runtimeContext),
  });
}

function mergeMastraContext(
  existing: AgentExecutionOptionsBase<unknown>['context'] | undefined,
  runtimeContext: readonly MastraContextMessage[],
): MastraContextMessage[] {
  return [...(existing ?? []), ...runtimeContext];
}

function toProviderMessages(input: NimiMastraContextBridgeInput): readonly NimiMessage[] {
  const fromMastra = toNimiMessages(input.messages);
  if (fromMastra.length > 0) {
    return fromMastra;
  }
  const query = normalizeText(input.query);
  return query ? [{ role: 'user', content: [textPart(query)] }] : [];
}

function toNimiMessages(messages: unknown): readonly NimiMessage[] {
  if (typeof messages === 'string') {
    const text = normalizeText(messages);
    return text ? [{ role: 'user', content: [textPart(text)] }] : [];
  }
  if (Array.isArray(messages)) {
    return messages.flatMap(toNimiMessage).filter((message): message is NimiMessage => Boolean(message));
  }
  const message = toNimiMessage(messages);
  return message ? [message] : [];
}

function toNimiMessage(message: unknown): NimiMessage | null {
  if (!message || typeof message !== 'object') {
    return null;
  }
  const record = message as { readonly role?: unknown; readonly content?: unknown };
  const role = toNimiRole(record.role);
  if (!role) {
    return null;
  }
  const content = toTextParts(record.content);
  if (content.length === 0) {
    return null;
  }
  return { role, content };
}

function toNimiRole(role: unknown): NimiMessage['role'] | null {
  return role === 'system' || role === 'user' || role === 'assistant' ? role : null;
}

function toTextParts(content: unknown): readonly NimiMessagePart[] {
  if (typeof content === 'string') {
    const text = normalizeText(content);
    return text ? [textPart(text)] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  return content.flatMap((part) => {
    if (!part || typeof part !== 'object') {
      return [];
    }
    const record = part as { readonly type?: unknown; readonly text?: unknown };
    if (record.type !== 'text') {
      return [];
    }
    const text = normalizeText(record.text);
    return text ? [textPart(text)] : [];
  });
}

function materialToText(material: NimiAiContextMaterial): string {
  if (typeof material === 'string') {
    return normalizeText(material);
  }
  if (Array.isArray(material)) {
    return partsToText(material);
  }
  const record = material as { readonly content?: unknown };
  if (Array.isArray(record.content)) {
    return partsToText(record.content as readonly NimiMessagePart[]);
  }
  return normalizeText(record.content);
}

function partsToText(parts: readonly NimiMessagePart[]): string {
  return parts
    .map(partToText)
    .filter(Boolean)
    .join('\n\n');
}

function partToText(part: NimiMessagePart): string {
  if (part.type === 'text') {
    return normalizeText(part.text);
  }
  if (part.type === 'file') {
    return `[file ${part.mediaType}${part.filename ? ` ${part.filename}` : ''}]`;
  }
  return dataToText(part.data);
}

function dataToText(data: NimiJsonValue): string {
  return stableJsonStringify(data);
}

function isJsonObject(value: NimiJsonValue | undefined): value is NimiJsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableJsonStringify(value: NimiJsonValue): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: NimiJsonValue): NimiJsonValue {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!isJsonObject(value)) {
    return value;
  }
  const sorted: Record<string, NimiJsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJson(value[key]);
  }
  return sorted;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

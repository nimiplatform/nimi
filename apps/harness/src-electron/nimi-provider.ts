import { createAssistantMessageEventStream, type AssistantMessage, type Model, type ProviderStreams, type TranscriptContext } from '@earendil-works/pi-ai';
import { createProvider } from '@earendil-works/pi-ai/models';
import { createNimiLocalAppTextModel, type NimiGenerateTextRequest } from '@nimiplatform/sdk/ai';
import type { NimiLocalAppTextTurnInput } from '@nimiplatform/sdk/app';
import type { NimiJsonObject } from '@nimiplatform/sdk/contracts';
import { isNimiError } from '@nimiplatform/sdk/types';
import type { NimiElectronAppBusinessServices } from '@nimiplatform/kit/shell/electron/main';

type Message = NimiGenerateTextRequest['messages'][number];
type TurnItem = NonNullable<Message['turnItems']>[number];
type ImageUploader = NimiElectronAppBusinessServices['ai']['artifacts'];
type ReasoningOptions = NonNullable<NonNullable<NimiGenerateTextRequest['parameters']>['reasoning']>;
type ReasoningCapabilities = {
  readonly followsModelDefault?: boolean;
  readonly supportsDisabled: boolean;
  readonly supportsRequired: boolean;
  readonly supportsAdaptive: boolean;
  readonly efforts: readonly string[];
  readonly supportsBudget?: boolean;
  readonly presentations: readonly ('hidden' | 'summary')[];
};

export type ReasoningChoice = { value: string; label: string };

const EFFORT_LABELS: Record<string, string> = {
  'model-default': 'Model default',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  maximum: 'Maximum',
};

export function projectReasoningChoices(capabilities?: ReasoningCapabilities | null): ReasoningChoice[] {
  if (!capabilities) return [];
  const choices: ReasoningChoice[] = [{ value: 'default', label: 'Default' }];
  if (capabilities.supportsDisabled) choices.push({ value: 'off', label: 'Off' });
  if (capabilities.supportsAdaptive || capabilities.supportsRequired) {
    for (const effort of capabilities.efforts) {
      if (effort === 'model-default') {
        if (!capabilities.efforts.some(item => item !== 'model-default')) {
          choices.push({ value: 'model-default', label: 'On' });
        }
        continue;
      }
      choices.push({ value: effort, label: EFFORT_LABELS[effort] ?? effort });
    }
  }
  return choices.length > 1 ? choices : [];
}

export function buildReasoningOptions(
  capabilities: ReasoningCapabilities | undefined | null,
  selectedEffort: string | undefined | null,
): ReasoningOptions | undefined {
  if (!capabilities || !selectedEffort || selectedEffort === 'default') return undefined;
  if (selectedEffort === 'off') {
    if (!capabilities.supportsDisabled) return undefined;
    return { activation: 'disabled', presentation: 'hidden' };
  }
  if (!capabilities.efforts.includes(selectedEffort)) return undefined;
  const activation = capabilities.supportsAdaptive
    ? 'adaptive'
    : capabilities.supportsRequired
      ? 'required'
      : undefined;
  if (!activation) return undefined;
  const presentation = capabilities.presentations.includes('summary') ? 'summary' : 'hidden';
  return {
    activation,
    effort: selectedEffort as Extract<ReasoningOptions, { effort: string }>['effort'],
    presentation,
  };
}

export function nimiProvider(
  ai: NimiElectronAppBusinessServices['ai'],
  modelId: string,
  label: string,
  reasoning: boolean,
  imageInput = false,
  contextWindow?: number,
  configuration?: NimiLocalAppTextTurnInput['configuration'],
  getReasoningOptions?: ReasoningOptions | (() => ReasoningOptions | undefined),
) {
  const aiModel = createNimiLocalAppTextModel(ai, {configuration});
  const model: Model<'nimi-text'> = {
    api: 'nimi-text', provider: 'nimi', id: modelId, name: label, baseUrl: '',
    input: imageInput ? ['text', 'image'] : ['text'], reasoning, contextWindow: contextWindow ?? 0, maxTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const stream: ProviderStreams['stream'] = (selected, context, options) => {
    const events = createAssistantMessageEventStream();
    const output: AssistantMessage = {
      api: selected.api, provider: selected.provider, model: selected.id, role: 'assistant',
      timestamp: Date.now(), content: [], stopReason: 'pending',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...model.cost, total: 0 } },
      diagnostics: [
        { type: 'nimi.usage-unreported', timestamp: Date.now() },
        { type: 'nimi.cost-unreported', timestamp: Date.now() },
        { type: 'nimi.cache-usage-unreported', timestamp: Date.now() },
      ],
    };
    void (async () => {
      try {
        const resolvedReasoning = typeof getReasoningOptions === 'function' ? getReasoningOptions() : getReasoningOptions;
        const request = await translateRequest(context, ai.artifacts, selected.id, options?.signal, resolvedReasoning);
        let finish: 'stop' | 'length' | 'toolUse' | undefined;
        events.push({ type: 'start', partial: output });
        const streamText = aiModel.streamText;
        if (!streamText) throw new Error('Nimi protected streaming is unavailable.');
        for await (const event of await streamText(request)) {
          switch (event.type) {
            case 'text-delta': {
              const index = event.itemIndex ?? output.content.length;
              if (!output.content[index]) {
                output.content[index] = { type: 'text', text: '' };
                events.push({ type: 'text_start', contentIndex: index, partial: output });
              }
              const item = output.content[index];
              if (item.type !== 'text') throw new Error('Nimi returned conflicting text item indices.');
              item.text += event.text;
              events.push({ type: 'text_delta', contentIndex: index, delta: event.text, partial: output });
              break;
            }
            case 'reasoning-summary-delta': {
              const index = event.itemIndex ?? output.content.length;
              if (!output.content[index]) {
                output.content[index] = { type: 'thinking', thinking: '' };
                events.push({ type: 'thinking_start', contentIndex: index, partial: output });
              }
              const item = output.content[index];
              if (item.type !== 'thinking') throw new Error('Nimi returned conflicting reasoning item indices.');
              item.thinking += event.text;
              events.push({ type: 'thinking_delta', contentIndex: index, delta: event.text, partial: output });
              break;
            }
            case 'reasoning-continuity': {
              const index = event.itemIndex ?? output.content.length;
              const { kind, version, payload } = event.carrier;
              output.content[index] = {
                type: 'thinking', thinking: '', redacted: true,
                thinkingSignature: JSON.stringify({ kind, version, payload: Buffer.from(payload).toString('base64') }),
              };
              events.push({ type: 'thinking_start', contentIndex: index, partial: output });
              break;
            }
            case 'tool-call': {
              const index = event.itemIndex ?? output.content.length;
              const { id, name, arguments: args } = event.toolCall;
              if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('Nimi returned non-object tool arguments.');
              // Runtime's admitted ToolCall has JSON object arguments.
              const toolCall = { type: 'toolCall' as const, id, name, arguments: { ...(args as NimiJsonObject) } };
              output.content[index] = toolCall;
              events.push({ type: 'toolcall_start', contentIndex: index, partial: output });
              events.push({ type: 'toolcall_end', contentIndex: index, toolCall, partial: output });
              break;
            }
            case 'done':
              if (event.configuration) {
                output.diagnostics?.push({ type: 'nimi.config-captured', timestamp:Date.now(), details:{...event.configuration} });
              }
              if (event.usage?.promptTokens !== undefined && event.usage.completionTokens !== undefined) {
                output.usage.input = event.usage.promptTokens;
                output.usage.output = event.usage.completionTokens;
                output.usage.totalTokens = event.usage.promptTokens + event.usage.completionTokens;
                output.diagnostics = output.diagnostics?.filter(item => item.type !== 'nimi.usage-unreported');
              }
              if (event.finishReason === 'stop') finish = 'stop';
              else if (event.finishReason === 'length') finish = 'length';
              else if (event.finishReason === 'tool-calls') finish = 'toolUse';
              else throw new Error(`Unsupported Nimi finish reason: ${event.finishReason}`);
              break;
          }
        }
        if (!finish) throw new Error('Nimi stream closed before its terminal event.');
        if (Array.from(output.content).some(item => item === undefined)) throw new Error('Nimi stream returned incomplete output indices.');
        for (const [index, item] of output.content.entries()) {
          if (item.type === 'text') events.push({ type: 'text_end', contentIndex: index, content: item.text, partial: output });
          if (item.type === 'thinking') events.push({ type: 'thinking_end', contentIndex: index, content: item.thinking, partial: output });
        }
        output.stopReason = finish;
        events.push({ type: 'done', reason: finish, message: output });
      } catch (error) {
        output.stopReason = options?.signal?.aborted ? 'aborted' : 'error';
        output.errorMessage = error instanceof Error ? error.message : String(error);
        if (isNimiError(error)) {
          const { reasonCode, actionHint, traceId, retryable, interruption } = error;
          output.diagnostics?.push({
            type: 'nimi.execution-error', timestamp: Date.now(),
            details: { reasonCode, actionHint, traceId, retryable, ...(interruption ? { interruption: { ...interruption } } : {}) },
          });
        }
        events.push({ type: 'error', reason: output.stopReason, error: output });
      } finally {
        events.end(output);
      }
    })();
    return events;
  };
  return createProvider({
    id: 'nimi', name: 'Nimi Runtime', models: [model],
    auth: { apiKey: { name: 'Protected Nimi Host', resolve: async () => ({ auth: {} }) } },
    api: { stream, streamSimple: stream },
  });
}

async function translateRequest(
  context: TranscriptContext,
  artifacts: ImageUploader,
  modelId: string,
  signal?: AbortSignal,
  reasoningOptions?: ReasoningOptions,
): Promise<NimiGenerateTextRequest> {
  const messages: Message[] = [];
  const tools = new Map<string, NonNullable<NimiGenerateTextRequest['tools']>[number]>();
  for (const message of context.messages) {
    signal?.throwIfAborted();
    switch (message.role) {
      case 'system': {
        const text = (typeof message.content === 'string' ? message.content : message.content.map(part => part.text).join(''))
          + Object.values(message.sections ?? {}).filter(section => section !== null).join('');
        if (text) messages.push({ role: 'system', content: [{ type: 'text', text }] });
        for (const tool of message.toolsAdded ?? []) {
          // Pi's Tool definition represents a JSON Schema object.
          tools.set(tool.name, { type: 'function', name: tool.name, description: tool.description, inputSchema: tool.parameters as NimiJsonObject });
        }
        for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
        break;
      }
      case 'user':
        messages.push({ role: 'user', content: typeof message.content === 'string'
          ? [{ type: 'text', text: message.content }] : await mediaContent(message.content, artifacts) });
        break;
      case 'assistant': {
        const turnItems: TurnItem[] = message.content.flatMap((item): TurnItem[] => {
          if (item.type === 'text') return [{ type: 'output', output: { type: 'text', text: item.text } }];
          if (item.type === 'toolCall') return [{ type: 'output', output: { type: 'tool-call', toolCall: { id: item.id, name: item.name, arguments: item.arguments } } }];
          if (message.provider !== 'nimi' || message.model !== modelId) return [];
          if (!item.thinkingSignature) {
            return item.thinking ? [{ type: 'output', output: { type: 'reasoning-summary', text: item.thinking } }] : [];
          }
          const carrier = JSON.parse(item.thinkingSignature) as { kind: string; version: number; payload: string };
          return [{ type: 'output', output: { type: 'reasoning-continuity', carrier: { ...carrier, payload: Buffer.from(carrier.payload, 'base64') } } }];
        });
        if (turnItems.length) messages.push({ role: 'assistant', content: [], turnItems });
        break;
      }
      case 'toolResult': {
        const text = message.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
        const images = message.content.filter(item => item.type === 'image');
        const uploadedImages = images.length ? await mediaContent(images, artifacts) : [];
        // Keep tool-returned images strictly under role: 'tool' provenance (NEVER re-wrap as role: 'user').
        messages.push({
          role: 'tool',
          content: uploadedImages,
          turnItems: [{
            type: 'tool-result',
            toolResult: { toolCallId: message.toolCallId, toolName: message.toolName, result: text, isError: message.isError },
          }],
        });
        break;
      }
    }
  }
  return {
    messages,
    tools: [...tools.values()],
    ...(reasoningOptions ? { parameters: { reasoning: reasoningOptions } } : {}),
    signal,
  };
}

async function mediaContent(parts: readonly ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[], artifacts: ImageUploader): Promise<Message['content']> {
  return Promise.all(parts.map(async part => {
    if (part.type === 'text') return { type: 'text' as const, text: part.text };
    const bytes = Uint8Array.from(Buffer.from(part.data, 'base64'));
    const mimeType = part.mimeType;
    if (mimeType !== 'image/png' && mimeType !== 'image/jpeg' && mimeType !== 'image/webp' && mimeType !== 'image/gif') {
      throw new Error(`Unsupported image format: ${mimeType}`);
    }
    const uploaded = await artifacts.upload({ bytes, mimeType });
    return { type: 'artifact-ref' as const, artifactId: uploaded.artifactId, mediaType: part.mimeType };
  }));
}

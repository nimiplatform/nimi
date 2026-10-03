import type { NimiLocalAppAIConsumptionClient } from '../app/local-app-runtime-platform-ai.js';
import { validateLocalAppTextInput, modelTextOutputToLocalApp, localAppTextOutputToModel, isLocalAppTextImageMime, isLocalAppTextMediaMime, type NimiLocalAppTextPart, type NimiLocalAppTextTurnInput, type NimiLocalAppTextTurnItem } from '../app/local-app-text.js';
import { assertExactKeys, localAppError, localAppProjectionError } from '../app/local-app-runtime-platform-validation.js';
import type { NimiRunEvent } from '../contracts/index.js';
import { createNimiError } from '../../types/index.js';
import { collectNimiTextStream, type NimiAiModel, type NimiGenerateTextRequest } from './index.js';

export type NimiLocalAppTextModelOptions = {
  /** Explicit Runtime mode. SYNC exposes events only after the complete result. */
  readonly executionMode?: 'stream' | 'sync';
};

type TextCarrier = Pick<NimiLocalAppAIConsumptionClient, 'text'>;
type SynchronousTextCarrier = Pick<NimiLocalAppAIConsumptionClient, 'text' | 'scenario'>;

function invalid(detail: string): never {
  return localAppError(`Local App text model cannot represent ${detail}.`, 'SDK_LOCAL_APP_INPUT_INVALID', 'use_admitted_local_app_text_fields');
}

function localInput(request: NimiGenerateTextRequest): NimiLocalAppTextTurnInput {
  assertExactKeys(request, ['messages', 'tools', 'toolChoice', 'responseFormat', 'parameters', 'signal'], 'text model request');
  const parameters = request.parameters ?? {};
  assertExactKeys(parameters, ['temperature', 'topP', 'topK', 'maxTokens', 'presencePenalty', 'frequencyPenalty', 'stop', 'seed'], 'Local App text parameters');
  if (!Array.isArray(request.messages)) invalid('messages');
  const messages = request.messages.map((message) => {
    assertExactKeys(message, ['role', 'content', 'turnItems'], 'Local App model message');
    if (!Array.isArray(message.content)) invalid('message content');
    const items = message.turnItems;
    if (items !== undefined && !Array.isArray(items)) invalid('ordered transcript');
    if (Array.isArray(items) && items.length > 0) {
      if (message.content.length !== 0 || (message.role !== 'assistant' && message.role !== 'tool')) invalid('ordered transcript');
      if (message.role === 'tool' && items.some((item) => item?.type !== 'tool-result')) invalid('tool transcript');
      const turnItems = items.map((item) => item.type === 'output'
        ? { ...item, output: modelTextOutputToLocalApp(item.output) } : item);
      return { role: 'assistant' as const, text: '', turnItems: turnItems as readonly NimiLocalAppTextTurnItem[] };
    }
    if (message.role !== 'system' && message.role !== 'user') invalid('non-canonical assistant transcript');
    if (message.content.some((part) => part?.type !== 'text')) {
      if (message.role !== 'user') invalid('media outside a user message');
      const parts = message.content.map((part): NimiLocalAppTextPart => {
        if (part?.type === 'text') {
          assertExactKeys(part, ['type', 'text'], 'Local App message part');
          if (typeof part.text !== 'string') return invalid('text content');
          return { type: 'text', text: part.text };
        }
        if (part?.type === 'file') {
          assertExactKeys(part, ['type', 'mediaType', 'data', 'filename'], 'Local App image file');
          if (typeof part.data !== 'string' || !isLocalAppTextImageMime(part.mediaType) || (part.filename !== undefined && typeof part.filename !== 'string')) return invalid('image file metadata');
          return { type: 'image-url', url: part.data };
        }
        if (part?.type === 'artifact-ref') {
          assertExactKeys(part, ['type', 'artifactId', 'localArtifactId', 'mediaType', 'displayName'], 'Local App media artifact');
          if (part.localArtifactId !== undefined || typeof part.artifactId !== 'string' || !part.artifactId || !isLocalAppTextMediaMime(part.mediaType)
            || (part.displayName !== undefined && typeof part.displayName !== 'string')) return invalid('media artifact reference; use the App artifact upload result');
          return { type: 'artifact-ref', artifactId: part.artifactId, mediaType: part.mediaType, ...(part.displayName === undefined ? {} : { displayName: part.displayName }) };
        }
        return invalid('non-image content');
      });
      return { role: 'user' as const, text: '', parts };
    }
    const text = message.content.map((part) => {
      assertExactKeys(part, ['type', 'text'], 'Local App message part');
      if (part.type !== 'text' || typeof part.text !== 'string') invalid('non-text content');
      return part.text;
    }).join('');
    return { role: message.role, text };
  });
  if (request.tools !== undefined && !Array.isArray(request.tools)) invalid('tools');
  const tools = request.tools?.map((tool) => {
    if (tool.type === 'provider') invalid('provider tools');
    assertExactKeys(tool, ['type', 'name', 'description', 'inputSchema', 'execute', 'policy', 'visibility'], 'Local App function tool');
    if ((tool.execute !== undefined && typeof tool.execute !== 'function') || tool.visibility === 'internal') invalid('function tool metadata');
    // Execution/approval policy stays with the caller. A model only receives
    // the declaration; this binding never invokes the callback.
    return { type: 'function' as const, name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
  });
  return validateLocalAppTextInput({
    messages, tools, toolChoice: request.toolChoice, responseFormat: request.responseFormat,
    ...parameters, stop: typeof parameters.stop === 'string' ? [parameters.stop] : parameters.stop,
  });
}

/** Bind one model step to an explicitly selected protected Runtime mode.
 * The default collects the text-turn stream. SYNC executes one Scenario and
 * projects its complete ordered output as events; it never retries in another
 * mode. Neither mode executes business tools or owns a multi-step workflow.
 */
// @nimi-authority: rule.nimi.sdks.feature-clients.local-app-text-behaviors
export function createNimiLocalAppTextModel(ai: TextCarrier, options?: { readonly executionMode?: 'stream' }): NimiAiModel;
export function createNimiLocalAppTextModel(ai: SynchronousTextCarrier, options: NimiLocalAppTextModelOptions): NimiAiModel;
export function createNimiLocalAppTextModel(
  ai: TextCarrier & Partial<Pick<NimiLocalAppAIConsumptionClient, 'scenario'>>,
  options: NimiLocalAppTextModelOptions = {},
): NimiAiModel {
  assertExactKeys(options, ['executionMode'], 'Local App text model options');
  if (options.executionMode !== undefined && options.executionMode !== 'sync' && options.executionMode !== 'stream') invalid('execution mode');
  if (options.executionMode === 'sync' && typeof ai.scenario?.execute !== 'function') invalid('synchronous Scenario carrier');

  async function* executeText(request: NimiGenerateTextRequest): AsyncGenerator<NimiRunEvent> {
    request.signal?.throwIfAborted();
    const input = localInput(request);
    const result = await ai.scenario!.execute({ type: 'text-generate', ...input }, request.signal ? { signal: request.signal } : undefined);
    request.signal?.throwIfAborted();
    if (result.output.type !== 'text-generate') localAppProjectionError('synchronous text output');
    for (const [itemIndex, localItem] of result.output.items.entries()) {
      request.signal?.throwIfAborted();
      const item = localAppTextOutputToModel(localItem);
      if (item.type === 'text') yield { type: 'text-delta', text: item.text, itemIndex };
      else if (item.type === 'tool-call') yield { type: 'tool-call', toolCall: item.toolCall, itemIndex };
      else if (item.type === 'reasoning-continuity') yield { type: 'reasoning-continuity', carrier: item.carrier, itemIndex, itemCompleted: true };
      else localAppProjectionError('synchronous text output item');
    }
    request.signal?.throwIfAborted();
    yield { type: 'done', finishReason: result.output.finishReason };
  }

  async function* streamText(request: NimiGenerateTextRequest): AsyncGenerator<NimiRunEvent> {
    request.signal?.throwIfAborted();
    const input = localInput(request);
    let stream: Awaited<ReturnType<typeof ai.text.streamTurn>> | undefined;
    let close: Promise<void> | undefined;
    const abort = () => {
      if (stream) {
        close ??= stream.cancel();
        void close.catch(() => {}); // observed by finally, not an unhandled rejection
      }
    };
    request.signal?.addEventListener('abort', abort, { once: true });
    try {
      stream = await ai.text.streamTurn(input);
      if (request.signal?.aborted) { abort(); request.signal.throwIfAborted(); }
      for await (const event of stream) {
        request.signal?.throwIfAborted();
        if (event.type === 'delta') yield { type: 'text-delta', text: event.text, itemIndex: event.itemIndex };
        else if (event.type === 'tool-call') yield { type: 'tool-call', toolCall: event.toolCall, itemIndex: event.itemIndex };
        else if (event.type === 'reasoning-continuity') yield { type: 'reasoning-continuity', carrier: { ...event.carrier, payload: new Uint8Array(event.carrier.payload) }, itemIndex: event.itemIndex, itemCompleted: true };
        else if (event.type === 'completed') yield { type: 'done', finishReason: event.finishReason };
        else throw createNimiError({
          message: `Nimi text generation failed: ${event.reasonCode}.`,
          code: event.reasonCode, reasonCode: event.reasonCode, actionHint: event.actionHint,
          traceId: event.traceId,
          source: 'runtime', interruption: event.interruption,
          retryable: event.interruption?.resubmitDisposition === 'caller-may-resubmit',
        });
      }
      request.signal?.throwIfAborted();
    } catch (error) {
      request.signal?.throwIfAborted();
      throw error;
    } finally {
      request.signal?.removeEventListener('abort', abort);
      if (stream) await (close ??= stream.cancel());
    }
  }
  const selectedText = options.executionMode === 'sync' ? executeText : streamText;
  return Object.freeze({
    model: Object.freeze({ modelId: 'text.generate' as const }),
    generateText: (request: NimiGenerateTextRequest) => collectNimiTextStream(selectedText(request)),
    streamText: selectedText,
  });
}

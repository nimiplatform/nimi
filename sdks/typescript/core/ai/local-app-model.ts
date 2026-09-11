import type { NimiLocalAppAIConsumptionClient } from '../app/local-app-runtime-platform-ai';
import { validateLocalAppTextInput, type NimiLocalAppTextTurnInput, type NimiLocalAppTextTurnItem } from '../app/local-app-text';
import { assertExactKeys, localAppError } from '../app/local-app-runtime-platform-validation';
import type { NimiRunEvent } from '../contracts';
import { createNimiError } from '../../types';
import { collectNimiTextStream, type NimiAiModel, type NimiGenerateTextRequest } from './index';

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
      return { role: 'assistant' as const, text: '', turnItems: items as readonly NimiLocalAppTextTurnItem[] };
    }
    if (message.role !== 'system' && message.role !== 'user') invalid('non-canonical assistant transcript');
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

/** Bind the common single-step model interface to the current protected App.
 * generateText collects the same cancellable stream; neither method executes
 * tools or owns a multi-step workflow.
 */
// @nimi-authority: rule.nimi.sdks.feature-clients.local-app-text-behaviors
export function createNimiLocalAppTextModel(ai: Pick<NimiLocalAppAIConsumptionClient, 'text'>): NimiAiModel {
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
        else if (event.type === 'completed') yield { type: 'done', finishReason: event.finishReason };
        else throw createNimiError({
          message: `Nimi text generation failed: ${event.reasonCode}.`,
          code: event.reasonCode, reasonCode: event.reasonCode, actionHint: event.actionHint,
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
  return Object.freeze({
    model: Object.freeze({ modelId: 'text.generate' as const }),
    generateText: (request: NimiGenerateTextRequest) => collectNimiTextStream(streamText(request)),
    streamText,
  });
}

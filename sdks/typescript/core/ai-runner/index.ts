import type {
  NimiAiTrace,
  NimiJsonObject,
  NimiJsonValue,
  NimiMessage,
  NimiMessagePart,
  NimiRunEvent,
  NimiTool,
  NimiToolCall,
  NimiUsage,
} from '../contracts';
import type { NimiAiModel, NimiGenerateTextRequest, NimiGenerateTextResult } from '../ai';
import { createNimiAiRunner } from './runner';

export type NimiAiRunnerEvent =
  | { readonly type: 'ai-runner-start'; readonly runnerId: string }
  | { readonly type: 'model-request'; readonly messageCount: number; readonly toolCount: number }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'reasoning'; readonly text: string }
  | { readonly type: 'tool-call'; readonly toolCall: NimiToolCall }
  | { readonly type: 'tool-result'; readonly toolCallId: string; readonly name: string; readonly result: NimiJsonValue }
  | { readonly type: 'approval-requested'; readonly toolCall: NimiToolCall }
  | { readonly type: 'external-execution-requested'; readonly toolCall: NimiToolCall }
  | { readonly type: 'artifact'; readonly artifact: NimiJsonObject }
  | { readonly type: 'warning'; readonly code: string; readonly message: string }
  | { readonly type: 'error'; readonly code: string; readonly message: string }
  | { readonly type: 'finish'; readonly finishReason: NimiGenerateTextResult['finishReason']; readonly usage?: NimiUsage };

export interface NimiAiRunnerSpec {
  readonly id: string;
  readonly name: string;
  readonly instructions?: string;
  readonly tools?: readonly NimiTool[];
  readonly instructionPacks?: readonly NimiAiInstructionPack[];
  readonly contextProviders?: readonly NimiAiContextProvider[];
  readonly metadata?: NimiJsonObject;
}

export interface NimiAiContextProviderInput {
  readonly runner: NimiAiRunnerSpec;
  readonly model: NimiAiModel;
  readonly messages: readonly NimiMessage[];
}

export interface NimiAiInstructionPack {
  readonly id: string;
  readonly content: string;
}

export interface NimiAiContextProvider {
  readonly id: string;
  load(input?: NimiAiContextProviderInput): Promise<NimiAiContextMaterial> | NimiAiContextMaterial;
}

export type NimiAiContextQuery =
  | string
  | ((input: NimiAiContextProviderInput) => string | Promise<string | undefined> | undefined);

export type NimiAiContextMaterial =
  | string
  | NimiMessage
  | readonly NimiMessagePart[]
  | { readonly role?: 'system' | 'user'; readonly content: string };

export interface NimiAiRunnerRunRequest {
  readonly runner: NimiAiRunnerSpec;
  readonly model: NimiAiModel;
  readonly messages: readonly NimiMessage[];
}

export interface NimiAiRunnerRunResult {
  readonly result: NimiGenerateTextResult;
  readonly trace: NimiAiTrace;
}

export async function runNimiAiRunner(request: NimiAiRunnerRunRequest): Promise<NimiAiRunnerRunResult> {
  const { result, trace } = await createNimiAiRunner().run(request);
  return {
    result,
    trace,
  };
}

export async function* streamNimiAiRunner(request: NimiAiRunnerRunRequest): AsyncIterable<NimiRunEvent> {
  if (!request.model.streamText) {
    throw new Error(`AI runner ${request.runner.id} model does not support streaming`);
  }
  yield* await request.model.streamText({
    messages: request.messages,
    tools: request.runner.tools,
  });
}

export async function resolveNimiAiContextQuery(
  query: NimiAiContextQuery | undefined,
  input: NimiAiContextProviderInput | undefined,
): Promise<string> {
  if (typeof query === 'string') {
    return query.trim();
  }
  if (typeof query === 'function' && input) {
    return String(await query(input) ?? '').trim();
  }
  return input ? latestUserText(input.messages) : '';
}

function latestUserText(messages: readonly NimiMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') {
      continue;
    }
    const text = message.content
      .filter((part) => part.type === 'text')
      .map((part) => (part.type === 'text' ? part.text.trim() : ''))
      .filter(Boolean)
      .join('\n\n');
    if (text) {
      return text;
    }
  }
  return '';
}

export * from './runner';
export * from './app-ai';

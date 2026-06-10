import type {
  NimiAgentTrace,
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
import { createNimiAgentRunner } from './runner';

export type NimiAgentEvent =
  | { readonly type: 'agent-start'; readonly agentId: string }
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

export interface NimiAgentSpec {
  readonly id: string;
  readonly name: string;
  readonly instructions?: string;
  readonly tools?: readonly NimiTool[];
  readonly instructionPacks?: readonly NimiAgentInstructionPack[];
  readonly contextProviders?: readonly NimiAgentContextProvider[];
  readonly metadata?: NimiJsonObject;
}

export interface NimiAgentContextProviderInput {
  readonly agent: NimiAgentSpec;
  readonly model: NimiAiModel;
  readonly messages: readonly NimiMessage[];
}

export interface NimiAgentInstructionPack {
  readonly id: string;
  readonly content: string;
}

export interface NimiAgentContextProvider {
  readonly id: string;
  load(input?: NimiAgentContextProviderInput): Promise<NimiAgentContextMaterial> | NimiAgentContextMaterial;
}

export type NimiAgentContextQuery =
  | string
  | ((input: NimiAgentContextProviderInput) => string | Promise<string | undefined> | undefined);

export type NimiAgentContextMaterial =
  | string
  | NimiMessage
  | readonly NimiMessagePart[]
  | { readonly role?: 'system' | 'user'; readonly content: string };

export interface NimiAgentRunRequest {
  readonly agent: NimiAgentSpec;
  readonly model: NimiAiModel;
  readonly messages: readonly NimiMessage[];
}

export interface NimiAgentRunResult {
  readonly result: NimiGenerateTextResult;
  readonly trace: NimiAgentTrace;
}

export async function runNimiAgent(request: NimiAgentRunRequest): Promise<NimiAgentRunResult> {
  const { result, trace } = await createNimiAgentRunner().run(request);
  return {
    result,
    trace,
  };
}

export async function* streamNimiAgent(request: NimiAgentRunRequest): AsyncIterable<NimiRunEvent> {
  if (!request.model.streamText) {
    throw new Error(`agent ${request.agent.id} model does not support streaming`);
  }
  yield* await request.model.streamText({
    model: request.model.model,
    messages: request.messages,
    tools: request.agent.tools,
  });
}

export async function resolveNimiAgentContextQuery(
  query: NimiAgentContextQuery | undefined,
  input: NimiAgentContextProviderInput | undefined,
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
export * from './runtime-client';

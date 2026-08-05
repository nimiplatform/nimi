import type { NimiAiModel, NimiGenerateTextRequest, NimiGenerateTextResult } from '../ai';
import { createNimiError } from '../../types';
import {
  textPart,
  type NimiAiTrace,
  type NimiJsonObject,
  type NimiJsonValue,
  type NimiMessage,
  type NimiMessagePart,
  type NimiTool,
} from '../contracts';
import type {
  NimiAiContextMaterial,
  NimiAiContextProviderInput,
  NimiAiRunnerEvent,
  NimiAiRunnerRunRequest,
  NimiAiRunnerSpec,
} from './index';

export interface NimiAiRunner {
  run(request: NimiAiRunnerRunRequest): Promise<NimiAiRunnerResult>;
}

export interface NimiAiRunnerResult {
  readonly result: NimiGenerateTextResult;
  readonly request: NimiGenerateTextRequest;
  readonly events: readonly NimiAiRunnerEvent[];
  readonly trace: NimiAiTrace;
}

export function createNimiAiRunner(): NimiAiRunner {
  return {
    async run(request) {
      const modelRequest = await buildNimiAiRunnerModelRequest(request.runner, request.model, request.messages);
      const events: NimiAiRunnerEvent[] = [
        { type: 'ai-runner-start', runnerId: request.runner.id },
        {
          type: 'model-request',
          messageCount: modelRequest.messages.length,
          toolCount: modelRequest.tools?.length ?? 0,
        },
      ];

      const result = await request.model.generateText(modelRequest);
      appendModelResultEvents(events, result);
      await appendToolLifecycleEvents(events, result, request.runner.tools ?? []);
      events.push({ type: 'finish', finishReason: result.finishReason, usage: result.usage });

      return {
        result,
        request: modelRequest,
        events,
        trace: toNimiAiTrace(request.runner.id, events),
      };
    },
  };
}

export async function buildNimiAiRunnerModelRequest(
  runner: NimiAiRunnerSpec,
  model: NimiAiModel,
  messages: readonly NimiMessage[],
): Promise<NimiGenerateTextRequest> {
  const contextInput: NimiAiContextProviderInput = { runner, model, messages };
  return {
    messages: [
      ...materializeInstructionMessages(runner),
      ...(await materializeContextMessages(runner, contextInput)),
      ...messages,
    ],
    tools: runner.tools,
  };
}

function materializeInstructionMessages(runner: NimiAiRunnerSpec): readonly NimiMessage[] {
  const instructions = [
    runner.instructions,
    ...(runner.instructionPacks?.map((pack) => pack.content) ?? []),
  ].filter((content): content is string => Boolean(content && content.trim()));

  if (instructions.length === 0) {
    return [];
  }

  return [
    {
      role: 'system',
      content: [textPart(instructions.join('\n\n'))],
    },
  ];
}

async function materializeContextMessages(
  runner: NimiAiRunnerSpec,
  input: NimiAiContextProviderInput,
): Promise<readonly NimiMessage[]> {
  const messages: NimiMessage[] = [];
  for (const provider of runner.contextProviders ?? []) {
    const material = await provider.load(input);
    messages.push(toContextMessage(material));
  }
  return messages;
}

function toContextMessage(material: NimiAiContextMaterial): NimiMessage {
  if (typeof material === 'string') {
    return { role: 'user', content: [textPart(material)] };
  }
  if (isMessagePartArray(material)) {
    return { role: 'user', content: material };
  }
  if (isNimiMessage(material)) {
    return material;
  }
  if ('content' in material) {
    const role = material.role ?? 'user';
    return { role, content: [textPart(material.content)] };
  }
  return material;
}

function appendModelResultEvents(events: NimiAiRunnerEvent[], result: NimiGenerateTextResult): void {
  const reasoning = extractReasoningText(result.raw);
  if (reasoning) {
    events.push({ type: 'reasoning', text: reasoning });
  }
  if (result.text) {
    events.push({ type: 'text', text: result.text });
  }
  for (const warning of result.warnings ?? []) {
    events.push({ type: 'warning', code: warning.code, message: warning.message });
  }
  for (const artifact of extractArtifacts(result.raw)) {
    events.push({ type: 'artifact', artifact });
  }
  for (const toolCall of result.toolCalls ?? []) {
    events.push({ type: 'tool-call', toolCall });
  }
  for (const toolResult of result.toolResults ?? []) {
    events.push({
      type: 'tool-result',
      toolCallId: toolResult.toolCallId,
      name: toolResult.toolName,
      result: toolResult.result,
    });
  }
}

async function appendToolLifecycleEvents(
  events: NimiAiRunnerEvent[],
  result: NimiGenerateTextResult,
  tools: readonly NimiTool[],
): Promise<void> {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  for (const toolCall of result.toolCalls ?? []) {
    if (toolCall.providerExecuted) {
      continue;
    }
    const tool = toolsByName.get(toolCall.name);
    if (!tool) {
      const message = `tool ${toolCall.name} was not registered`;
      events.push({ type: 'error', code: 'unknown_tool', message });
      throw aiRunnerToolError('SDK_AI_RUNNER_TOOL_UNKNOWN', message, toolCall.name);
    }
    if (tool.type === 'provider') {
      continue;
    }
    if (tool.policy === 'approval-required') {
      events.push({ type: 'approval-requested', toolCall });
      continue;
    }
    if (tool.policy === 'external-execution') {
      events.push({ type: 'external-execution-requested', toolCall });
      continue;
    }
    if (!tool.execute) {
      const message = `tool ${tool.name} does not expose execute`;
      events.push({ type: 'error', code: 'tool_executor_missing', message });
      throw aiRunnerToolError('SDK_AI_RUNNER_TOOL_EXECUTOR_MISSING', message, tool.name);
    }
    try {
      const toolResult = await tool.execute(toolCall.arguments);
      events.push({ type: 'tool-result', toolCallId: toolCall.id, name: tool.name, result: toolResult });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      events.push({
        type: 'error',
        code: 'tool_execution_failed',
        message,
      });
      throw aiRunnerToolError('SDK_AI_RUNNER_TOOL_EXECUTION_FAILED', message, tool.name);
    }
  }
}

function aiRunnerToolError(reasonCode: string, message: string, toolName: string) {
  return createNimiError({
    message,
    code: reasonCode,
    reasonCode,
    actionHint: 'check_ai_runner_tool_execution',
    source: 'sdk',
    details: { toolName },
  });
}

export function toNimiAiTrace(runnerId: string, events: readonly NimiAiRunnerEvent[]): NimiAiTrace {
  return {
    traceId: `ai-runner:${runnerId}`,
    events: events.map(toRunEvent),
    steps: events.map((event, index) => ({
      id: `ai-runner:${runnerId}:${index}:${event.type}`,
      kind: aiRunnerEventStepKind(event),
      status: event.type === 'error' ? 'failed' : 'completed',
      input: aiRunnerEventInput(event),
    })),
  };
}

function toRunEvent(event: NimiAiRunnerEvent) {
  if (event.type === 'text') {
    return { type: 'text-delta' as const, text: event.text };
  }
  if (event.type === 'tool-call') {
    return { type: 'tool-call' as const, toolCall: event.toolCall };
  }
  if (event.type === 'warning') {
    return { type: 'warning' as const, code: event.code, message: event.message };
  }
  if (event.type === 'error') {
    return { type: 'error' as const, code: event.code, message: event.message };
  }
  if (event.type === 'finish') {
    return { type: 'done' as const, finishReason: event.finishReason, usage: event.usage };
  }
  return { type: 'trace' as const, trace: { traceId: `event:${event.type}`, events: [], steps: [] } };
}

function aiRunnerEventStepKind(event: NimiAiRunnerEvent): 'model' | 'tool' | 'approval' | 'external-execution' | 'workflow' {
  if (event.type === 'tool-call' || event.type === 'tool-result') {
    return 'tool';
  }
  if (event.type === 'approval-requested') {
    return 'approval';
  }
  if (event.type === 'external-execution-requested') {
    return 'external-execution';
  }
  if (event.type === 'model-request' || event.type === 'text' || event.type === 'reasoning') {
    return 'model';
  }
  return 'workflow';
}

function aiRunnerEventInput(event: NimiAiRunnerEvent): NimiJsonValue {
  return JSON.parse(JSON.stringify(event)) as NimiJsonValue;
}

function extractReasoningText(raw: NimiJsonValue | undefined): string | undefined {
  if (!isJsonObject(raw)) {
    return undefined;
  }
  const reasoning = raw.reasoning ?? raw.reasoningText;
  return typeof reasoning === 'string' && reasoning.length > 0 ? reasoning : undefined;
}

function extractArtifacts(raw: NimiJsonValue | undefined): readonly NimiJsonObject[] {
  if (!isJsonObject(raw) || !Array.isArray(raw.artifacts)) {
    return [];
  }
  return raw.artifacts.filter(isJsonObject);
}

function isJsonObject(value: NimiJsonValue | undefined): value is NimiJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMessagePartArray(value: NimiAiContextMaterial): value is readonly NimiMessagePart[] {
  return Array.isArray(value);
}

function isNimiMessage(value: NimiAiContextMaterial): value is NimiMessage {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Array.isArray((value as { readonly content?: unknown }).content);
}
